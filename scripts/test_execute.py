"""
execute.py 리팩터링 안전망 테스트.
리팩터링 전후 동작이 동일한지 검증한다.
"""

import contextlib
import json
import os
import subprocess
import sys
import textwrap
import types
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import execute as ex


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_project(tmp_path):
    """phases/, CLAUDE.md, docs/ 를 갖춘 임시 프로젝트 구조."""
    phases_dir = tmp_path / "phases"
    phases_dir.mkdir()

    claude_md = tmp_path / "CLAUDE.md"
    claude_md.write_text("# Rules\n- rule one\n- rule two", encoding="utf-8")

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "arch.md").write_text("# Architecture\nSome content", encoding="utf-8")
    (docs_dir / "guide.md").write_text("# Guide\nAnother doc", encoding="utf-8")

    return tmp_path


@pytest.fixture
def phase_dir(tmp_project):
    """step 3개를 가진 phase 디렉토리."""
    d = tmp_project / "phases" / "0-mvp"
    d.mkdir()

    index = {
        "project": "TestProject",
        "phase": "mvp",
        "steps": [
            {"step": 0, "name": "setup", "status": "completed", "summary": "프로젝트 초기화 완료"},
            {"step": 1, "name": "core", "status": "completed", "summary": "핵심 로직 구현"},
            {"step": 2, "name": "ui", "status": "pending"},
        ],
    }
    (d / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    (d / "step2.md").write_text("# Step 2: UI\n\nUI를 구현하세요.", encoding="utf-8")

    return d


@pytest.fixture
def top_index(tmp_project):
    """phases/index.json (top-level)."""
    top = {
        "phases": [
            {"dir": "0-mvp", "status": "pending"},
            {"dir": "1-polish", "status": "pending"},
        ]
    }
    p = tmp_project / "phases" / "index.json"
    p.write_text(json.dumps(top, indent=2), encoding="utf-8")
    return p


@pytest.fixture
def executor(tmp_project, phase_dir):
    """테스트용 StepExecutor 인스턴스. git 호출은 별도 mock 필요."""
    with patch.object(ex, "ROOT", tmp_project):
        inst = ex.StepExecutor("0-mvp")
    # 내부 경로를 tmp_project 기준으로 재설정
    inst._root = str(tmp_project)
    inst._phases_dir = tmp_project / "phases"
    inst._phase_dir = phase_dir
    inst._phase_dir_name = "0-mvp"
    inst._index_file = phase_dir / "index.json"
    inst._top_index_file = tmp_project / "phases" / "index.json"
    return inst


# ---------------------------------------------------------------------------
# _stamp (= 이전 now_iso)
# ---------------------------------------------------------------------------

class TestStamp:
    def test_returns_kst_timestamp(self, executor):
        result = executor._stamp()
        assert "+0900" in result

    def test_format_is_iso(self, executor):
        result = executor._stamp()
        dt = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert dt.tzinfo is not None

    def test_is_current_time(self, executor):
        before = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0)
        result = executor._stamp()
        after = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0) + timedelta(seconds=1)
        parsed = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert before <= parsed <= after


# ---------------------------------------------------------------------------
# _read_json / _write_json
# ---------------------------------------------------------------------------

class TestJsonHelpers:
    def test_roundtrip(self, tmp_path):
        data = {"key": "값", "nested": [1, 2, 3]}
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, data)
        loaded = ex.StepExecutor._read_json(p)
        assert loaded == data

    def test_save_ensures_ascii_false(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"한글": "테스트"})
        raw = p.read_text(encoding="utf-8")
        assert "한글" in raw
        assert "\\u" not in raw

    def test_save_indented(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"a": 1})
        raw = p.read_text(encoding="utf-8")
        assert "\n" in raw

    def test_load_nonexistent_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            ex.StepExecutor._read_json(tmp_path / "nope.json")


# ---------------------------------------------------------------------------
# _build_step_context
# ---------------------------------------------------------------------------

class TestBuildStepContext:
    def test_includes_completed_with_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text(encoding="utf-8"))
        result = ex.StepExecutor._build_step_context(index)
        assert "Step 0 (setup): 프로젝트 초기화 완료" in result
        assert "Step 1 (core): 핵심 로직 구현" in result

    def test_excludes_pending(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text(encoding="utf-8"))
        result = ex.StepExecutor._build_step_context(index)
        assert "ui" not in result

    def test_excludes_completed_without_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text(encoding="utf-8"))
        del index["steps"][0]["summary"]
        result = ex.StepExecutor._build_step_context(index)
        assert "setup" not in result
        assert "core" in result

    def test_empty_when_no_completed(self):
        index = {"steps": [{"step": 0, "name": "a", "status": "pending"}]}
        result = ex.StepExecutor._build_step_context(index)
        assert result == ""

    def test_has_header(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text(encoding="utf-8"))
        result = ex.StepExecutor._build_step_context(index)
        assert result.startswith("## 이전 Step 산출물")


# ---------------------------------------------------------------------------
# _build_preamble
# ---------------------------------------------------------------------------

class TestBuildPreamble:
    def test_includes_project_name(self, executor):
        result = executor._build_preamble(2, "")
        assert "TestProject" in result

    def test_includes_step_context(self, executor):
        ctx = "## 이전 Step 산출물\n\n- Step 0: done"
        result = executor._build_preamble(2, ctx)
        assert "이전 Step 산출물" in result

    def test_includes_commit_example(self, executor):
        result = executor._build_preamble(2, "")
        assert "feat(mvp):" in result

    def test_includes_rules(self, executor):
        result = executor._build_preamble(2, "")
        assert "작업 규칙" in result
        assert "AC" in result

    def test_no_retry_section_by_default(self, executor):
        result = executor._build_preamble(2, "")
        assert "이전 시도 실패" not in result

    def test_retry_section_with_prev_error(self, executor):
        result = executor._build_preamble(2, "", prev_error="타입 에러 발생")
        assert "이전 시도 실패" in result
        assert "타입 에러 발생" in result

    def test_includes_max_retries(self, executor):
        result = executor._build_preamble(2, "")
        assert str(ex.StepExecutor.MAX_RETRIES) in result

    def test_asks_for_result_file_instead_of_index(self, executor):
        # index.json을 통째로 읽고 고치면 앞 step summary가 전부 컨텍스트에 들어온다
        result = executor._build_preamble(2, "")
        assert "/phases/0-mvp/step2-result.json" in result
        assert "index.json은 읽거나 고치지 마라" in result

    def test_states_summary_limit(self, executor):
        result = executor._build_preamble(2, "")
        assert f"{ex.StepExecutor.SUMMARY_LIMIT}자" in result

    def test_mentions_spec_diff_field(self, executor):
        result = executor._build_preamble(2, "")
        assert "spec_diff" in result


# ---------------------------------------------------------------------------
# _update_top_index
# ---------------------------------------------------------------------------

class TestUpdateTopIndex:
    def test_completed(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text(encoding="utf-8"))
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "completed"
        assert "completed_at" in mvp

    def test_error(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("error")
        data = json.loads(top_index.read_text(encoding="utf-8"))
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "error"
        assert "failed_at" in mvp

    def test_blocked(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("blocked")
        data = json.loads(top_index.read_text(encoding="utf-8"))
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "blocked"
        assert "blocked_at" in mvp

    def test_other_phases_unchanged(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text(encoding="utf-8"))
        polish = next(p for p in data["phases"] if p["dir"] == "1-polish")
        assert polish["status"] == "pending"

    def test_nonexistent_dir_is_noop(self, executor, top_index):
        executor._top_index_file = top_index
        executor._phase_dir_name = "no-such-dir"
        original = json.loads(top_index.read_text(encoding="utf-8"))
        executor._update_top_index("completed")
        after = json.loads(top_index.read_text(encoding="utf-8"))
        for p_before, p_after in zip(original["phases"], after["phases"]):
            assert p_before["status"] == p_after["status"]

    def test_no_top_index_file(self, executor, tmp_path):
        executor._top_index_file = tmp_path / "nonexistent.json"
        executor._update_top_index("completed")  # should not raise


# ---------------------------------------------------------------------------
# _checkout_branch (mocked)
# ---------------------------------------------------------------------------

class TestRunGit:
    def test_decodes_git_output_as_utf8(self, executor):
        # git은 한글 경로가 든 메시지를 utf-8로 출력한다. 시스템 기본값(cp949)으로 읽으면 깨진다
        with patch("subprocess.run", return_value=MagicMock(returncode=0)) as mock_run:
            executor._run_git("status")

        assert mock_run.call_args[0][0] == ["git", "status"]
        assert mock_run.call_args[1]["encoding"] == "utf-8"

    def test_spawn_failure_exits(self, executor):
        # 띄운 Claude Code 세션이 닫히면 새 프로세스가 0xC0000142로 죽는다. 커밋 실패를 WARN으로 넘기지 않는다
        with patch("subprocess.run", return_value=MagicMock(returncode=0xC0000142, stdout="", stderr="")):
            with pytest.raises(SystemExit) as exc_info:
                executor._run_git("add", "-A")
        assert exc_info.value.code == 1


class TestCheckoutBranch:
    def _mock_git(self, executor, responses):
        call_idx = {"i": 0}
        def fake_git(*args):
            idx = call_idx["i"]
            call_idx["i"] += 1
            if idx < len(responses):
                return responses[idx]
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

    def test_already_on_branch(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="feat-mvp\n", stderr=""),
        ])
        executor._checkout_branch()  # should return without checkout

    def test_branch_exists_checkout(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_branch_not_exists_create(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="not found"),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_checkout_fails_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="dirty tree"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 1

    def test_no_git_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=1, stdout="", stderr="not a git repo"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# _commit_step (mocked)
# ---------------------------------------------------------------------------

class TestCommitStep:
    def test_two_phase_commit(self, executor):
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_calls = [c for c in calls if c[0] == "commit"]
        assert len(commit_calls) == 2
        assert "feat(mvp):" in commit_calls[0][2]
        assert "chore(mvp):" in commit_calls[1][2]

    def test_no_code_changes_skips_feat_commit(self, executor):
        call_count = {"diff": 0}
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                call_count["diff"] += 1
                if call_count["diff"] == 1:
                    return MagicMock(returncode=0)
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_msgs = [c[2] for c in calls if c[0] == "commit"]
        assert len(commit_msgs) == 1
        assert "chore" in commit_msgs[0]

    def test_result_file_kept_out_of_feat_commit(self, executor):
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        first_commit = next(i for i, c in enumerate(calls) if c[0] == "commit")
        assert ("reset", "HEAD", "--", "phases/0-mvp/step2-result.json") in calls[:first_commit]


# ---------------------------------------------------------------------------
# _invoke_claude (mocked)
# ---------------------------------------------------------------------------

class TestInvokeClaude:
    def test_invokes_claude_with_correct_args(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"result": "ok"}', stderr="")
        step = {"step": 2, "name": "ui"}
        preamble = "PREAMBLE\n"

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            output = executor._invoke_claude(step, preamble)

        cmd = mock_run.call_args[0][0]
        assert cmd[0] == "claude"
        assert "-p" in cmd
        assert "--dangerously-skip-permissions" in cmd
        assert "--output-format" in cmd
        prompt = mock_run.call_args[1]["input"]
        assert "PREAMBLE" in prompt
        assert "UI를 구현하세요" in prompt

    def test_prompt_is_passed_via_stdin_not_command_line(self, executor):
        # Windows 명령줄은 약 32,767자가 상한이라 긴 프롬프트를 인자로 넘기면 실행이 실패한다
        mock_result = MagicMock(returncode=0, stdout="{}", stderr="")
        long_preamble = "가" * 40000

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            executor._invoke_claude({"step": 2, "name": "ui"}, long_preamble)

        cmd = mock_run.call_args[0][0]
        assert cmd == ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json"]
        assert mock_run.call_args[1]["input"].startswith(long_preamble)
        assert mock_run.call_args[1]["encoding"] == "utf-8"

    def test_output_json_is_written_as_utf8(self, executor):
        mock_result = MagicMock(returncode=0, stdout="결과 ✓ ↻", stderr="")

        with patch("subprocess.run", return_value=mock_result):
            executor._invoke_claude({"step": 2, "name": "ui"}, "preamble")

        raw = (executor._phase_dir / "step2-output.json").read_bytes().decode("utf-8")
        assert json.loads(raw)["stdout"] == "결과 ✓ ↻"

    def test_saves_output_json(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"ok": true}', stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result):
            executor._invoke_claude(step, "preamble")

        output_file = executor._phase_dir / "step2-output.json"
        assert output_file.exists()
        data = json.loads(output_file.read_text(encoding="utf-8"))
        assert data["step"] == 2
        assert data["name"] == "ui"
        assert data["exitCode"] == 0

    def test_nonexistent_step_file_exits(self, executor):
        step = {"step": 99, "name": "nonexistent"}
        with pytest.raises(SystemExit) as exc_info:
            executor._invoke_claude(step, "preamble")
        assert exc_info.value.code == 1

    def test_timeout_is_1800(self, executor):
        mock_result = MagicMock(returncode=0, stdout="{}", stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            executor._invoke_claude(step, "preamble")

        assert mock_run.call_args[1]["timeout"] == 1800

    def test_spawn_failure_exits(self, executor):
        mock_result = MagicMock(returncode=0xC0000142, stdout="", stderr="")

        with patch("subprocess.run", return_value=mock_result):
            with pytest.raises(SystemExit) as exc_info:
                executor._invoke_claude({"step": 2, "name": "ui"}, "preamble")
        assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# _execute_single_step (mocked)
# ---------------------------------------------------------------------------

class TestExecuteSingleStep:
    STEP = {"step": 2, "name": "ui"}

    def _fake_claude(self, executor, results):
        """시도마다 results의 다음 값을 step2-result.json에 쓴다. None이면 아무것도 쓰지 않고, str이면 그대로 쓴다."""
        preambles = []
        result_file = executor._phase_dir / "step2-result.json"
        def fake(step, preamble):
            preambles.append(preamble)
            r = results[len(preambles) - 1]
            if isinstance(r, dict):
                result_file.write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
            elif isinstance(r, str):
                result_file.write_text(r, encoding="utf-8")
        executor._invoke_claude = fake
        executor._commit_step = MagicMock()
        return preambles

    def _step_entry(self, executor):
        return json.loads(executor._index_file.read_text(encoding="utf-8"))["steps"][2]

    def test_reports_elapsed_seconds(self, executor, capsys):
        @contextlib.contextmanager
        def fake_indicator(label):
            info = types.SimpleNamespace(elapsed=0.0)
            yield info
            info.elapsed = 42.7

        self._fake_claude(executor, [{"status": "completed", "summary": "UI 구현"}])
        with patch.object(ex, "progress_indicator", fake_indicator):
            executor._execute_single_step(self.STEP)

        assert "✓ Step 2: ui [42s]" in capsys.readouterr().out

    def test_prompt_does_not_include_claude_md_or_docs(self, executor):
        # CLAUDE.md는 claude -p가 자동으로 읽고, docs는 step 파일이 필요한 것만 읽게 한다
        preambles = self._fake_claude(executor, [{"status": "completed", "summary": "UI 구현"}])

        executor._execute_single_step(self.STEP)

        assert "rule one" not in preambles[0]
        assert "# Architecture" not in preambles[0]
        assert "# Guide" not in preambles[0]

    def test_completed_result_is_copied_to_index(self, executor):
        self._fake_claude(executor, [{"status": "completed", "summary": "UI 구현", "spec_diff": "버튼 문구가 spec과 다름"}])

        assert executor._execute_single_step(self.STEP) is True

        entry = self._step_entry(executor)
        assert entry["status"] == "completed"
        assert entry["summary"] == "UI 구현"
        assert "completed_at" in entry
        # spec_diff는 다음 step 프롬프트로 가지 않게 결과 파일에만 남긴다
        assert "spec_diff" not in entry
        executor._commit_step.assert_called_once_with(2, "ui")

    def test_long_summary_is_clipped_in_index(self, executor):
        limit = ex.StepExecutor.SUMMARY_LIMIT
        self._fake_claude(executor, [{"status": "completed", "summary": "가" * (limit + 100)}])

        executor._execute_single_step(self.STEP)

        assert self._step_entry(executor)["summary"] == "가" * limit + "…"
        # 원문은 결과 파일에 남는다
        result = json.loads((executor._phase_dir / "step2-result.json").read_text(encoding="utf-8"))
        assert len(result["summary"]) == limit + 100

    def test_stale_result_file_is_removed_before_each_attempt(self, executor):
        # 이전 실행이 남긴 결과 파일을 이번 시도의 결과로 읽으면 안 된다
        result_file = executor._phase_dir / "step2-result.json"
        result_file.write_text(json.dumps({"status": "completed", "summary": "옛 결과"}), encoding="utf-8")
        seen = []
        def fake(step, preamble):
            seen.append(result_file.exists())
            result_file.write_text(json.dumps({"status": "completed", "summary": "새 결과"}), encoding="utf-8")
        executor._invoke_claude = fake
        executor._commit_step = MagicMock()

        executor._execute_single_step(self.STEP)

        assert seen == [False]
        assert self._step_entry(executor)["summary"] == "새 결과"

    def test_blocked_result_marks_index_and_exits_2(self, executor):
        self._fake_claude(executor, [{"status": "blocked", "blocked_reason": "API 키 필요"}])

        with pytest.raises(SystemExit) as exc_info:
            executor._execute_single_step(self.STEP)

        assert exc_info.value.code == 2
        entry = self._step_entry(executor)
        assert entry["status"] == "blocked"
        assert entry["blocked_reason"] == "API 키 필요"
        assert "blocked_at" in entry

    def test_error_result_is_retried_with_message(self, executor):
        preambles = self._fake_claude(executor, [
            {"status": "error", "error_message": "타입 에러 발생"},
            {"status": "completed", "summary": "UI 구현"},
        ])

        executor._execute_single_step(self.STEP)

        assert len(preambles) == 2
        assert "타입 에러 발생" in preambles[1]
        entry = self._step_entry(executor)
        assert entry["status"] == "completed"
        assert "error_message" not in entry

    def test_invalid_result_json_is_retried_as_error(self, executor):
        preambles = self._fake_claude(executor, ['{"status": "completed", "summary": "따옴표 "깨짐""}', {"status": "completed", "summary": "UI 구현"}])

        executor._execute_single_step(self.STEP)

        assert "step2-result.json" in preambles[1]
        assert self._step_entry(executor)["status"] == "completed"

    def test_missing_result_after_max_retries_marks_error(self, executor):
        preambles = self._fake_claude(executor, [None] * ex.StepExecutor.MAX_RETRIES)

        with pytest.raises(SystemExit) as exc_info:
            executor._execute_single_step(self.STEP)

        assert exc_info.value.code == 1
        assert len(preambles) == ex.StepExecutor.MAX_RETRIES
        entry = self._step_entry(executor)
        assert entry["status"] == "error"
        assert "Step did not update status" in entry["error_message"]
        assert "failed_at" in entry

    def test_spawn_failure_stops_without_retry_or_error_status(self, executor):
        executor._commit_step = MagicMock()
        mock_result = MagicMock(returncode=0xC0000142, stdout="", stderr="")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            with pytest.raises(SystemExit):
                executor._execute_single_step(self.STEP)

        assert mock_run.call_count == 1
        step = json.loads(executor._index_file.read_text(encoding="utf-8"))["steps"][2]
        assert step["status"] == "pending"
        assert "error_message" not in step


# ---------------------------------------------------------------------------
# progress_indicator (= 이전 Spinner)
# ---------------------------------------------------------------------------

class TestProgressIndicator:
    def test_context_manager(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.15)
        assert pi.elapsed >= 0.1

    def test_elapsed_increases(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.2)
        assert pi.elapsed > 0


# ---------------------------------------------------------------------------
# main() CLI 파싱 (mocked)
# ---------------------------------------------------------------------------

class TestMainCli:
    def test_no_args_exits(self):
        with patch("sys.argv", ["execute.py"]):
            with pytest.raises(SystemExit) as exc_info:
                ex.main()
            assert exc_info.value.code == 2  # argparse exits with 2

    def test_invalid_phase_dir_exits(self):
        with patch("sys.argv", ["execute.py", "nonexistent"]):
            with patch.object(ex, "ROOT", Path("/tmp/fake_nonexistent")):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 1

    def test_missing_index_exits(self, tmp_project):
        (tmp_project / "phases" / "empty").mkdir()
        with patch("sys.argv", ["execute.py", "empty"]):
            with patch.object(ex, "ROOT", tmp_project):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 1

    def test_reconfigures_stdio_to_utf8(self):
        # 출력을 파이프·파일로 받으면 Windows 기본값(cp949)이 ✓, ↻ 같은 기호를 인코딩하지 못한다
        fake_out, fake_err = MagicMock(), MagicMock()
        with patch("sys.argv", ["execute.py"]), patch("sys.stdout", fake_out), patch("sys.stderr", fake_err):
            with pytest.raises(SystemExit):
                ex.main()
        fake_out.reconfigure.assert_called_once_with(encoding="utf-8")
        fake_err.reconfigure.assert_called_once_with(encoding="utf-8")


# ---------------------------------------------------------------------------
# _check_blockers (= 이전 main() error/blocked 체크)
# ---------------------------------------------------------------------------

class TestCheckBlockers:
    def _make_executor_with_steps(self, tmp_project, steps):
        d = tmp_project / "phases" / "test-phase"
        d.mkdir(exist_ok=True)
        index = {"project": "T", "phase": "test", "steps": steps}
        (d / "index.json").write_text(json.dumps(index), encoding="utf-8")

        with patch.object(ex, "ROOT", tmp_project):
            inst = ex.StepExecutor.__new__(ex.StepExecutor)
        inst._root = str(tmp_project)
        inst._phases_dir = tmp_project / "phases"
        inst._phase_dir = d
        inst._phase_dir_name = "test-phase"
        inst._index_file = d / "index.json"
        inst._top_index_file = tmp_project / "phases" / "index.json"
        inst._phase_name = "test"
        inst._total = len(steps)
        return inst

    def test_error_step_exits_1(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "bad", "status": "error", "error_message": "fail"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 1

    def test_blocked_step_exits_2(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "stuck", "status": "blocked", "blocked_reason": "API key"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 2
