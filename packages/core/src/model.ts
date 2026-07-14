export interface WorkStream {
  id: string;
  name: string;
  weeklyBudgetHours: number;
  weight: number; // 0..1, used to bias overcommit scale-down (later)
  workdays: number[]; // 0=Sun..6=Sat
  active: boolean;
}

export type TaskSource = 'calendar' | 'gmail' | 'github' | 'folder' | 'manual';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export interface Task {
  id: string;
  streamId: string;
  title: string;
  source: TaskSource;
  sourceRef?: string;
  estimateHours?: number;
  deadline?: string; // ISO date
  status: TaskStatus;
  spentHours: number;
  waitingSince?: string; // ISO date — set when this task is awaiting a response
}

export interface TimeLog {
  date: string; // ISO date
  streamId: string;
  taskId?: string;
  hours: number;
}

export interface AllocationLine {
  streamId: string;
  targetHours: number;
  tasks: Task[];
}

export interface Allocation {
  date: string; // ISO date
  capacityHours: number;
  lines: AllocationLine[];
  overcommitted: boolean;
}

export type AlertType = 'deadline_risk' | 'dropped_ball' | 'falling_behind' | 'overcommit';
export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  streamId?: string;
  taskId?: string;
  message: string;
}
