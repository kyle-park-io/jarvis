export const VERSION = '0.1.0';

export type {
  WorkStream,
  Task,
  TaskSource,
  TaskStatus,
  TimeLog,
  AllocationLine,
  Allocation,
  Alert,
  AlertType,
  AlertSeverity,
} from './model';

export { allocate, round1, type AllocateInput, type AllocateResult } from './allocate';
export { rankTasks } from './rank';
export { deadlinePressure } from './pressure';
export { scanFallingBehind, scanDeadlineRisks, scanDroppedBalls } from './alerts';
export {
  parseISODate,
  toISODate,
  weekdayOf,
  weekStart,
  isSameWeek,
  daysUntil,
  countRemainingWorkdays,
  workdaysInWeek,
  workdaysElapsed,
} from './dates';
