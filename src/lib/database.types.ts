
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
            "class_rates": {
                  Row: {
                    "class_id": string,"created_at": string,"created_by": string | null,"effective_from": string,"id": string,"student_rate_per_hour": number,"tutor_rate_per_hour": number
                  }
                  ComputedFields: never
                  Insert: {
                    "class_id": string,"created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"id"?: string,"student_rate_per_hour": number,"tutor_rate_per_hour": number
                  }
                  Update: {
                    "class_id"?: string,"created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"id"?: string,"student_rate_per_hour"?: number,"tutor_rate_per_hour"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "class_rates_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_rates_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"classes": {
                  Row: {
                    "capacity": number,"created_at": string,"created_by": string | null,"description": string,"id": string,"name": string,"package_hours": number,"tutor_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity": number,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"name": string,"package_hours"?: number,"tutor_id": string
                  }
                  Update: {
                    "capacity"?: number,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"name"?: string,"package_hours"?: number,"tutor_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "classes_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "classes_tutor_id_fkey"
      columns: ["tutor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"enrollments": {
                  Row: {
                    "activated_at": string | null,"class_id": string,"created_at": string,"end_cause": Database["public"]['Enums']["end_cause"] | null,"end_reason": string | null,"ended_at": string | null,"id": string,"status": Database["public"]['Enums']["enrollment_status"],"student_id": string,"terms_accepted_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activated_at"?: string | null,"class_id": string,"created_at"?: string,"end_cause"?: Database["public"]['Enums']["end_cause"] | null,"end_reason"?: string | null,"ended_at"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["enrollment_status"],"student_id": string,"terms_accepted_at": string
                  }
                  Update: {
                    "activated_at"?: string | null,"class_id"?: string,"created_at"?: string,"end_cause"?: Database["public"]['Enums']["end_cause"] | null,"end_reason"?: string | null,"ended_at"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["enrollment_status"],"student_id"?: string,"terms_accepted_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrollments_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrollments_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"id": string,"invoice_id": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"invoice_id": string,"note"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"invoice_id"?: string,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_events_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "amount": number,"cancel_reason": string | null,"cancelled_at": string | null,"enrollment_id": string,"hours": number,"id": string,"issued_at": string,"issued_by": string | null,"kind": Database["public"]['Enums']["invoice_kind"],"paid_at": string | null,"payment_due_at": string | null,"rate_per_hour": number,"status": Database["public"]['Enums']["invoice_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"enrollment_id": string,"hours": number,"id"?: string,"issued_at"?: string,"issued_by"?: string | null,"kind": Database["public"]['Enums']["invoice_kind"],"paid_at"?: string | null,"payment_due_at"?: string | null,"rate_per_hour": number,"status"?: Database["public"]['Enums']["invoice_status"]
                  }
                  Update: {
                    "amount"?: number,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"enrollment_id"?: string,"hours"?: number,"id"?: string,"issued_at"?: string,"issued_by"?: string | null,"kind"?: Database["public"]['Enums']["invoice_kind"],"paid_at"?: string | null,"payment_due_at"?: string | null,"rate_per_hour"?: number,"status"?: Database["public"]['Enums']["invoice_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_enrollment_id_fkey"
      columns: ["enrollment_id"]
isOneToOne: false
      referencedRelation: "enrollments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_issued_by_fkey"
      columns: ["issued_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"lessons": {
                  Row: {
                    "cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"class_id": string,"created_at": string,"created_by": string | null,"duration_minutes": number | null,"ends_at": string,"id": string,"series_id": string | null,"starts_at": string,"status": Database["public"]['Enums']["lesson_status"],"tutor_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"class_id": string,"created_at"?: string,"created_by"?: string | null,"duration_minutes"?: never,"ends_at": string,"id"?: string,"series_id"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["lesson_status"],"tutor_id": string
                  }
                  Update: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"class_id"?: string,"created_at"?: string,"created_by"?: string | null,"duration_minutes"?: never,"ends_at"?: string,"id"?: string,"series_id"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["lesson_status"],"tutor_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lessons_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lessons_tutor_id_fkey"
      columns: ["tutor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"logbook_entries": {
                  Row: {
                    "activities": string,"author_id": string,"created_at": string,"edited_by_admin": boolean,"id": string,"lesson_id": string,"logbook_id": string,"observation": string,"recommendation": string,"topic": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activities": string,"author_id": string,"created_at"?: string,"edited_by_admin"?: boolean,"id"?: string,"lesson_id": string,"logbook_id": string,"observation": string,"recommendation": string,"topic": string,"updated_at"?: string
                  }
                  Update: {
                    "activities"?: string,"author_id"?: string,"created_at"?: string,"edited_by_admin"?: boolean,"id"?: string,"lesson_id"?: string,"logbook_id"?: string,"observation"?: string,"recommendation"?: string,"topic"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "logbook_entries_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "logbook_entries_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: true
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "logbook_entries_logbook_id_fkey"
      columns: ["logbook_id"]
isOneToOne: false
      referencedRelation: "logbooks"
      referencedColumns: ["id"]
    }
                  ]
                },"logbook_entry_revisions": {
                  Row: {
                    "activities": string,"edited_at": string,"edited_by": string | null,"entry_id": string,"id": string,"observation": string,"recommendation": string,"topic": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activities": string,"edited_at"?: string,"edited_by"?: string | null,"entry_id": string,"id"?: string,"observation": string,"recommendation": string,"topic": string
                  }
                  Update: {
                    "activities"?: string,"edited_at"?: string,"edited_by"?: string | null,"entry_id"?: string,"id"?: string,"observation"?: string,"recommendation"?: string,"topic"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "logbook_entry_revisions_edited_by_fkey"
      columns: ["edited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "logbook_entry_revisions_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "logbook_entries"
      referencedColumns: ["id"]
    }
                  ]
                },"logbook_reviews": {
                  Row: {
                    "action": Database["public"]['Enums']["review_action"],"actor_id": string | null,"comment": string | null,"created_at": string,"entry_id": string | null,"id": string,"logbook_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": Database["public"]['Enums']["review_action"],"actor_id"?: string | null,"comment"?: string | null,"created_at"?: string,"entry_id"?: string | null,"id"?: string,"logbook_id": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["review_action"],"actor_id"?: string | null,"comment"?: string | null,"created_at"?: string,"entry_id"?: string | null,"id"?: string,"logbook_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "logbook_reviews_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "logbook_reviews_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "logbook_entries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "logbook_reviews_logbook_id_fkey"
      columns: ["logbook_id"]
isOneToOne: false
      referencedRelation: "logbooks"
      referencedColumns: ["id"]
    }
                  ]
                },"logbooks": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"class_id": string,"created_at": string,"id": string,"month": string,"status": Database["public"]['Enums']["logbook_status"],"submitted_at": string | null,"submitted_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"class_id": string,"created_at"?: string,"id"?: string,"month": string,"status"?: Database["public"]['Enums']["logbook_status"],"submitted_at"?: string | null,"submitted_by"?: string | null
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"class_id"?: string,"created_at"?: string,"id"?: string,"month"?: string,"status"?: Database["public"]['Enums']["logbook_status"],"submitted_at"?: string | null,"submitted_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "logbooks_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "logbooks_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "logbooks_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"bank": string | null,"id": string,"invoice_id": string,"kind": Database["public"]['Enums']["payment_kind"],"no_seat": boolean,"proof_path": string | null,"reference": string | null,"reject_reason": string | null,"reported_at": string,"reported_by": string | null,"reversal_reason": string | null,"reversed_at": string | null,"reversed_by": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"sender_name": string | null,"status": Database["public"]['Enums']["payment_status"],"transfer_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"bank"?: string | null,"id"?: string,"invoice_id": string,"kind": Database["public"]['Enums']["payment_kind"],"no_seat"?: boolean,"proof_path"?: string | null,"reference"?: string | null,"reject_reason"?: string | null,"reported_at"?: string,"reported_by"?: string | null,"reversal_reason"?: string | null,"reversed_at"?: string | null,"reversed_by"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"sender_name"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"transfer_date"?: string | null
                  }
                  Update: {
                    "amount"?: number,"bank"?: string | null,"id"?: string,"invoice_id"?: string,"kind"?: Database["public"]['Enums']["payment_kind"],"no_seat"?: boolean,"proof_path"?: string | null,"reference"?: string | null,"reject_reason"?: string | null,"reported_at"?: string,"reported_by"?: string | null,"reversal_reason"?: string | null,"reversed_at"?: string | null,"reversed_by"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"sender_name"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"transfer_date"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_reported_by_fkey"
      columns: ["reported_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_reversed_by_fkey"
      columns: ["reversed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string,"id": string,"role": Database["public"]['Enums']["user_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name": string,"id": string,"role": Database["public"]['Enums']["user_role"]
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["user_role"]
                  }
                  Relationships: [
                    
                  ]
                },"refunds": {
                  Row: {
                    "amount": number,"bank_reference": string | null,"cancel_reason": string | null,"cause": Database["public"]['Enums']["refund_cause"],"created_at": string,"created_by": string | null,"enrollment_id": string,"id": string,"invoice_id": string | null,"reason": string,"refunded_at": string | null,"refunded_by": string | null,"status": Database["public"]['Enums']["refund_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"bank_reference"?: string | null,"cancel_reason"?: string | null,"cause": Database["public"]['Enums']["refund_cause"],"created_at"?: string,"created_by"?: string | null,"enrollment_id": string,"id"?: string,"invoice_id"?: string | null,"reason": string,"refunded_at"?: string | null,"refunded_by"?: string | null,"status"?: Database["public"]['Enums']["refund_status"]
                  }
                  Update: {
                    "amount"?: number,"bank_reference"?: string | null,"cancel_reason"?: string | null,"cause"?: Database["public"]['Enums']["refund_cause"],"created_at"?: string,"created_by"?: string | null,"enrollment_id"?: string,"id"?: string,"invoice_id"?: string | null,"reason"?: string,"refunded_at"?: string | null,"refunded_by"?: string | null,"status"?: Database["public"]['Enums']["refund_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_enrollment_id_fkey"
      columns: ["enrollment_id"]
isOneToOne: false
      referencedRelation: "enrollments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_refunded_by_fkey"
      columns: ["refunded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"tutor_earnings": {
                  Row: {
                    "amount": number,"class_id": string,"created_at": string,"id": string,"lesson_id": string,"logbook_id": string,"minutes": number,"rate_per_hour": number,"tutor_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"class_id": string,"created_at"?: string,"id"?: string,"lesson_id": string,"logbook_id": string,"minutes": number,"rate_per_hour": number,"tutor_id": string
                  }
                  Update: {
                    "amount"?: number,"class_id"?: string,"created_at"?: string,"id"?: string,"lesson_id"?: string,"logbook_id"?: string,"minutes"?: number,"rate_per_hour"?: number,"tutor_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tutor_earnings_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tutor_earnings_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: true
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tutor_earnings_logbook_id_fkey"
      columns: ["logbook_id"]
isOneToOne: false
      referencedRelation: "logbooks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tutor_earnings_tutor_id_fkey"
      columns: ["tutor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "auth_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["user_role"]
                           },
"create_class":
{ Args: { "p_capacity": number,"p_description": string,"p_name": string,"p_package_hours": number,"p_student_rate": number,"p_tutor_id": string,"p_tutor_rate": number }; Returns: string
                           },
"current_class_rate":
{ Args: { "p_at"?: string,"p_class_id": string }; Returns: {
              "class_id": string,
"created_at": string,
"created_by": string | null,
"effective_from": string,
"id": string,
"student_rate_per_hour": number,
"tutor_rate_per_hour": number
            }
                          SetofOptions: {
        from: "*"
        to: "class_rates"
        isOneToOne: true
        isSetofReturn: false
      } },
"entry_class_id":
{ Args: { "p_entry_id": string }; Returns: string
                           },
"fail":
{ Args: { "p_code": string,"p_message": string }; Returns: undefined
                           },
"has_active_enrollment":
{ Args: { "p_class_id": string }; Returns: boolean
                           },
"has_any_enrollment":
{ Args: { "p_class_id": string }; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_class_tutor":
{ Args: { "p_class_id": string }; Returns: boolean
                           },
"lesson_month":
{ Args: { "p_ts": string }; Returns: string
                           },
"list_open_classes":
{ Args: Record<PropertyKey, never>; Returns: {
              "class_id": string,"description": string,"my_enrollment_id": string,"my_enrollment_status": Database["public"]['Enums']["enrollment_status"],"name": string,"package_hours": number,"package_price": number,"seats_left": number,"tutor_name": string
            }[]
                           },
"logbook_class_id":
{ Args: { "p_logbook_id": string }; Returns: string
                           },
"owns_enrollment":
{ Args: { "p_enrollment_id": string }; Returns: boolean
                           },
"owns_invoice":
{ Args: { "p_invoice_id": string }; Returns: boolean
                           },
"require_admin":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"set_class_capacity":
{ Args: { "p_capacity": number,"p_class_id": string }; Returns: undefined
                           },
"set_class_rates":
{ Args: { "p_class_id": string,"p_student_rate": number,"p_tutor_rate": number }; Returns: undefined
                           },
"shares_class_with":
{ Args: { "p_profile_id": string }; Returns: boolean
                           },
"teaches_in_class":
{ Args: { "p_class_id": string }; Returns: boolean
                           },
"update_class_details":
{ Args: { "p_class_id": string,"p_description": string,"p_name": string,"p_package_hours": number }; Returns: undefined
                           }
          }
          Enums: {
            "end_cause": "student"|"business"|"expired"|"rejected"|"not_renewed","enrollment_status": "pending_payment"|"awaiting_verification"|"active"|"cancelled"|"withdrawn","invoice_kind": "initial"|"renewal","invoice_status": "unpaid"|"awaiting_verification"|"paid"|"cancelled","lesson_status": "scheduled"|"cancelled","logbook_status": "draft"|"submitted"|"changes_requested"|"approved","payment_kind": "transfer_report"|"offline","payment_status": "pending"|"verified"|"rejected"|"reversed","refund_cause": "business"|"exception"|"late_no_seat","refund_status": "pending"|"refunded"|"cancelled","review_action": "submitted"|"changes_requested"|"admin_edited"|"approved","user_role": "admin"|"tutor"|"student"
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
            "end_cause": ["student", "business", "expired", "rejected", "not_renewed"],"enrollment_status": ["pending_payment", "awaiting_verification", "active", "cancelled", "withdrawn"],"invoice_kind": ["initial", "renewal"],"invoice_status": ["unpaid", "awaiting_verification", "paid", "cancelled"],"lesson_status": ["scheduled", "cancelled"],"logbook_status": ["draft", "submitted", "changes_requested", "approved"],"payment_kind": ["transfer_report", "offline"],"payment_status": ["pending", "verified", "rejected", "reversed"],"refund_cause": ["business", "exception", "late_no_seat"],"refund_status": ["pending", "refunded", "cancelled"],"review_action": ["submitted", "changes_requested", "admin_edited", "approved"],"user_role": ["admin", "tutor", "student"]
          }
        }
} as const
