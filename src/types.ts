export interface FizzyAuthConfig {
  baseUrl?: string;
  key: string;
  type: "api_key";
}

export interface FizzyCardReference {
  accountSlug: string;
  cardNumber: number;
  origin: string;
  url: string;
}

export interface FizzyUser {
  active?: boolean;
  created_at?: string;
  email_address?: string;
  id: string;
  name: string;
  role?: string;
  url?: string;
}

export interface FizzyBoard {
  all_access?: boolean;
  auto_postpone_period_in_days?: number;
  created_at?: string;
  id: string;
  name: string;
  url?: string;
}

export interface FizzyColumn {
  created_at?: string;
  id: string;
  name: string;
}

export interface FizzyStep {
  completed: boolean;
  content: string;
  id: string;
}

export interface FizzyComment {
  body: {
    html?: string;
    plain_text?: string;
  };
  created_at?: string;
  creator?: FizzyUser;
  id: string;
  updated_at?: string;
  url?: string;
}

export interface FizzyCard {
  board: FizzyBoard;
  closed?: boolean;
  column?: FizzyColumn;
  comments_url?: string;
  created_at?: string;
  creator?: FizzyUser;
  description?: string;
  description_html?: string;
  golden?: boolean;
  has_attachments?: boolean;
  id: string;
  image_url?: string | null;
  last_active_at?: string;
  number: number;
  reactions_url?: string;
  status?: string;
  steps?: FizzyStep[];
  tags?: string[];
  title: string;
  url: string;
}

export interface FizzyCardSnapshot {
  card: FizzyCard;
  comments: FizzyComment[];
  commentsTruncated: boolean;
  fetchedAt: string;
  sourceUrl: string;
}

export interface FizzyCommentCreateResult {
  comment: FizzyComment;
  sourceUrl: string;
}

export interface FizzyCloseResult {
  closedAt: string;
  sourceUrl: string;
}

export interface FizzyMoveToColumnResult {
  action: "already_in_column" | "created_and_moved" | "moved";
  column: FizzyColumn;
  sourceUrl: string;
}

export interface FizzyEnsureDoingResult extends FizzyMoveToColumnResult {
  action: "already_in_doing" | "created_and_moved" | "moved";
}

export interface FizzyAssignResult {
  action: "assigned" | "already_assigned" | "unassigned";
  assignee: FizzyUser;
  sourceUrl: string;
}
