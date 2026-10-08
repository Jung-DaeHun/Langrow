
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "chat_sessions": {
                  Row: {
                    "created_at": string,"ended_at": string | null,"feedback": Json | null,"feedback_status": string,"id": string,"language": string,"level": number,"operation_expires_at": string | null,"operation_token": string | null,"scenario_id": string,"status": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"ended_at"?: string | null,"feedback"?: Json | null,"feedback_status"?: string,"id"?: string,"language": string,"level": number,"operation_expires_at"?: string | null,"operation_token"?: string | null,"scenario_id": string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"ended_at"?: string | null,"feedback"?: Json | null,"feedback_status"?: string,"id"?: string,"language"?: string,"level"?: number,"operation_expires_at"?: string | null,"operation_token"?: string | null,"scenario_id"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"chat_turns": {
                  Row: {
                    "correction": Json | null,"created_at": string,"id": string,"reply": string | null,"reply_ko": string | null,"session_id": string,"status": string,"turn_no": number,"user_id": string,"user_text": string
                  }
                  Insert: {
                    "correction"?: Json | null,"created_at"?: string,"id"?: string,"reply"?: string | null,"reply_ko"?: string | null,"session_id": string,"status"?: string,"turn_no": number,"user_id": string,"user_text": string
                  }
                  Update: {
                    "correction"?: Json | null,"created_at"?: string,"id"?: string,"reply"?: string | null,"reply_ko"?: string | null,"session_id"?: string,"status"?: string,"turn_no"?: number,"user_id"?: string,"user_text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_turns_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "chat_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"id": number,"name": string,"props": NonNullable<Json>,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: never,"name": string,"props"?: NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"name"?: string,"props"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "agreed_at": string | null,"created_at": string,"current_language": string | null,"id": string,"last_study_date": string | null,"onboarded_at": string | null,"pro_until": string | null,"streak": number,"trial_started_at": string | null
                  }
                  Insert: {
                    "agreed_at"?: string | null,"created_at"?: string,"current_language"?: string | null,"id": string,"last_study_date"?: string | null,"onboarded_at"?: string | null,"pro_until"?: string | null,"streak"?: number,"trial_started_at"?: string | null
                  }
                  Update: {
                    "agreed_at"?: string | null,"created_at"?: string,"current_language"?: string | null,"id"?: string,"last_study_date"?: string | null,"onboarded_at"?: string | null,"pro_until"?: string | null,"streak"?: number,"trial_started_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"user_activity_days": {
                  Row: {
                    "activity_date": string,"user_id": string
                  }
                  Insert: {
                    "activity_date": string,"user_id": string
                  }
                  Update: {
                    "activity_date"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_levels": {
                  Row: {
                    "language": string,"level": number,"user_id": string
                  }
                  Insert: {
                    "language": string,"level": number,"user_id": string
                  }
                  Update: {
                    "language"?: string,"level"?: number,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_words": {
                  Row: {
                    "first_seen_at": string,"status": string,"updated_at": string,"user_id": string,"word_id": string
                  }
                  Insert: {
                    "first_seen_at"?: string,"status": string,"updated_at"?: string,"user_id": string,"word_id": string
                  }
                  Update: {
                    "first_seen_at"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string,"word_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_words_word_id_fkey"
      columns: ["word_id"]
isOneToOne: false
      referencedRelation: "words"
      referencedColumns: ["id"]
    }
                  ]
                },"word_explanations": {
                  Row: {
                    "choice": string,"created_at": string,"explanation": string,"word_hash": string,"word_id": string
                  }
                  Insert: {
                    "choice": string,"created_at"?: string,"explanation": string,"word_hash": string,"word_id": string
                  }
                  Update: {
                    "choice"?: string,"created_at"?: string,"explanation"?: string,"word_hash"?: string,"word_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "word_explanations_word_id_fkey"
      columns: ["word_id"]
isOneToOne: false
      referencedRelation: "words"
      referencedColumns: ["id"]
    }
                  ]
                },"words": {
                  Row: {
                    "distractors": (string)[],"example": string,"example_ko": string,"id": string,"language": string,"level": number,"meaning_ko": string,"rank": number,"reading": string | null,"word": string
                  }
                  Insert: {
                    "distractors": (string)[],"example": string,"example_ko": string,"id": string,"language": string,"level": number,"meaning_ko": string,"rank": number,"reading"?: string | null,"word": string
                  }
                  Update: {
                    "distractors"?: (string)[],"example"?: string,"example_ko"?: string,"id"?: string,"language"?: string,"level"?: number,"meaning_ko"?: string,"rank"?: number,"reading"?: string | null,"word"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "agree_terms":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"begin_chat_turn":
{ Args: { "p_session_id": string,"p_user_id": string,"p_user_text": string }; Returns: Json
                           },
"begin_end":
{ Args: { "p_session_id": string,"p_user_id": string }; Returns: Json
                           },
"begin_word_explanation":
{ Args: { "p_choice": string,"p_user_id": string,"p_word_id": string }; Returns: Json
                           },
"chat_failure_limit_reached":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"chat_turn_limit":
{ Args: { "p_user_id": string }; Returns: number
                           },
"check_readiness":
{ Args: { "p_language"?: string,"p_requirement": string,"p_user_id": string }; Returns: string
                           },
"create_chat_session":
{ Args: { "p_language": string,"p_level": number,"p_scenario_id": string,"p_user_id": string }; Returns: Json
                           },
"current_plan":
{ Args: { "p_user_id": string }; Returns: string
                           },
"end_chat_with_fallback":
{ Args: { "p_session_id": string,"p_user_id": string }; Returns: Json
                           },
"ensure_profile":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"fail_chat_turn":
{ Args: { "p_reason": string,"p_session_id": string,"p_token": string,"p_user_id": string }; Returns: Json
                           },
"fail_end":
{ Args: { "p_reason": string,"p_session_id": string,"p_token": string,"p_user_id": string }; Returns: Json
                           },
"fail_word_explanation":
{ Args: { "p_event_id": number,"p_reason": string,"p_user_id": string }; Returns: Json
                           },
"finish_chat_turn":
{ Args: { "p_correction": Json,"p_reply": string,"p_reply_ko": string,"p_session_id": string,"p_token": string,"p_user_id": string }; Returns: Json
                           },
"finish_end":
{ Args: { "p_feedback": Json,"p_session_id": string,"p_token": string,"p_user_id": string }; Returns: Json
                           },
"kst_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"kst_today_start":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"lower_level":
{ Args: { "p_language": string,"p_level": number,"p_user_id": string }; Returns: Json
                           },
"new_word_limit":
{ Args: { "p_user_id": string }; Returns: number
                           },
"record_activity":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"record_chat_failed":
{ Args: { "p_kind": string,"p_operation_token": string,"p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"record_event":
{ Args: { "p_name": string,"p_user_id": string }; Returns: Json
                           },
"record_limit_reached":
{ Args: { "p_feature": string,"p_user_id": string }; Returns: undefined
                           },
"recover_expired_operations":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"save_review":
{ Args: { "p_items": Json,"p_language": string,"p_user_id": string }; Returns: Json
                           },
"save_word_batch":
{ Args: { "p_items": Json,"p_language": string,"p_user_id": string }; Returns: Json
                           },
"save_word_explanation":
{ Args: { "p_choice": string,"p_example": string,"p_example_ko": string,"p_explanation": string,"p_meaning_ko": string,"p_word_id": string }; Returns: Json
                           },
"set_first_level":
{ Args: { "p_language": string,"p_level": number,"p_user_id": string }; Returns: Json
                           },
"start_trial":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"submit_level_test":
{ Args: { "p_from_level": number,"p_language": string,"p_passed": boolean,"p_score": number,"p_user_id": string }; Returns: Json
                           },
"switch_language":
{ Args: { "p_language": string,"p_user_id": string }; Returns: Json
                           },
"word_hash":
{ Args: { "p_word_id": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
