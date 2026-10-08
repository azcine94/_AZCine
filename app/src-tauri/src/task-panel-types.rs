use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Repository {
    pub id: String, pub label: String, pub path: String, pub scope: Vec<String>,
    pub revision: i64, pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String, pub number: i64, pub title: String, pub goal: String,
    pub scope: Vec<String>, pub criteria: Vec<String>, pub repository_id: Option<String>,
    pub lifecycle: String, pub pause_reason: String, pub source: String, pub resume_summary: String,
    pub revision: i64, pub created_at: String, pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Relation {
    pub id: String, pub from_id: String, pub to_id: String, pub kind: String,
    pub threshold: String, pub source: String, pub evidence_level: String,
    pub active: bool, pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Memory {
    pub id: String, pub task_id: Option<String>, pub repository_id: Option<String>,
    pub kind: String, pub body: String, pub source: String, pub status: String,
    pub supersedes: Option<String>, pub base_task_revision: Option<i64>,
    pub revision: i64, pub created_at: String,
    #[serde(default)] pub project_id: Option<String>,
    #[serde(default)] pub category: String,
    #[serde(default)] pub origin_level: String,
    #[serde(default)] pub source_refs: Value,
    #[serde(default)] pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub sequence: i64, pub request_id: String, pub object_id: String,
    pub kind: String, pub actor: String, pub detail: String, pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Execution {
    pub id: String, pub task_id: String, pub task_revision: i64, pub context_id: String,
    pub binding_id: String, pub binding_generation: i64, pub state: String,
    pub attempt: i64, pub request_id: String, pub authorization: Vec<String>,
    pub snapshot_id: Option<String>, pub reason: String, pub created_at: String, pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub id: String, pub task_id: String, pub server_id: String, pub workspace_id: String,
    pub pane_id: String, pub agent_id: String, pub kind: String, pub cwd: String,
    pub generation: i64, pub state: String, pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub id: String, pub task_id: String, pub execution_id: String, pub task_revision: i64,
    pub kind: String, pub level: String, pub status: String, pub path: String,
    pub hash: String, pub detail: Value, pub snapshot_id: Option<String>, pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: String, pub repository_id: Option<String>, pub kind: String, pub label: String,
    pub path: String, pub symbol: String, pub evidence_level: String,
    pub sources: Value, pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    #[serde(default)] pub workspace_error:String,
    #[serde(default)] pub execution_workspace:Option<crate::task_panel_locations::ExecutionWorkspace>,
    #[serde(default)] pub execution_profile:String,
    #[serde(default)] pub recommended_actions:Vec<String>,
    #[serde(default)] pub observation:Option<crate::task_panel_monitor::Observation>,
    #[serde(flatten)] pub task: Task,
    pub lane: String, pub reason_codes: Vec<String>, pub blockers: Vec<String>,
    pub allowed_actions: Vec<String>, pub prerequisites_total: usize, pub prerequisites_satisfied: usize,
    pub execution_state: Option<String>, pub check_state: String, pub acceptance_state: String,
    #[serde(default)] pub pending_creation: Option<crate::task_panel_execution::PendingCreation>,
    #[serde(default)] pub stop_pending: bool,
    #[serde(default)] pub plan: TaskPlan,
    #[serde(default)] pub object_kind: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskPlan {
    pub project_id: Option<String>, pub goal_id: Option<String>,
    #[serde(default)] pub phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProject {
    pub id: String, pub name: String, pub summary: String, pub repository_ids: Vec<String>,
    pub revision: i64, pub created_at: String,
    #[serde(default)] pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSnapshot {
    #[serde(default)] pub feedback:Vec<crate::task_panel_collaboration::Feedback>,
    #[serde(default)] pub monitor: crate::task_panel_monitor::Monitor,
    #[serde(default)] pub projects: Vec<TaskProject>,
    pub graph_revision: i64, pub tasks: Vec<TaskView>, pub repositories: Vec<Repository>,
    pub relations: Vec<Relation>, pub memories: Vec<Memory>, pub executions: Vec<Execution>,
    pub bindings: Vec<Binding>, pub evidence: Vec<Evidence>, pub events: Vec<Event>,
    pub last_sequence: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationInput {
    pub request_id: String, pub expected_revision: Option<i64>, pub action: Mutation,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Mutation {
    Project { id: String, name: String, summary: String, repository_ids: Vec<String> },
    ProjectDeleted { id: String, deleted: bool, approved: bool },
    Repository { id: String, label: String, path: String, scope: Vec<String>, #[serde(default)] project_id: Option<String> },
    SaveTask { id: String, title: String, goal: String, scope: Vec<String>, criteria: Vec<String>,
        repository_id: Option<String>, source: String, #[serde(default)] plan: Option<TaskPlan> },
    Lifecycle { id: String, lifecycle: String, reason: String },
    CancelStoppedExecution { id:String, execution_id:String, reason:String, approved:bool },
    KeepTaskWithoutWorktree { id:String, approved:bool },
    ResumeSummary { id: String, summary: String },
    Relation { from_id: String, to_id: String, kind: String, threshold: String, source: String },
    InvalidateRelation { id: String },
    ReviewRelation { id: String, reason: String },
    MemoryDraft { id: String, task_id: Option<String>, repository_id: Option<String>, kind: String,
        body: String, source: String, supersedes: Option<String>, #[serde(default)] project_id: Option<String> },
    ApplyMemory { id: String },
    CancelMemory { id: String },
    UpdateMemoryDraft { id: String, body: String, source: String, kind: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationReceipt { pub object_id: String, pub revision: i64, pub sequence: i64 }

pub const RELATION_KINDS: &[&str] = &["depends_on", "related_to", "governed_by", "supported_by",
    "executed_by", "produced", "checked_by", "imports", "calls", "registers", "reads", "writes", "contains", "may_affect"];
