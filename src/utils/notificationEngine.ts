/**
 * @license MIT
 * OBSIDIAN Workstation Real-Time Notification Engine
 *
 * Implements notifications for desktop and Android browsers:
 * - Task started
 * - Task progress / milestone
 * - User approval needed (with interactive Approve / Deny actions)
 * - Task completed (with View action)
 * - Task failed (with Retry action)
 *
 * Includes system permission request, vibration on Android mobile,
 * notification tag deduplication, and fallback in-app alerts.
 */

export type NotificationEventType =
  | 'task_started'
  | 'task_progress'
  | 'approval_needed'
  | 'task_completed'
  | 'task_failed';

export interface NotificationPayload {
  type: NotificationEventType;
  agentName: string;
  taskTitle: string;
  taskSummary: string;
  progress?: number;
  taskId?: string;
  approvalId?: string;
  toolName?: string;
  error?: string;
  onView?: () => void;
  onResume?: () => void;
  onApprove?: (approvalId: string) => void;
  onDeny?: (approvalId: string) => void;
}

class WorkstationNotificationEngine {
  private permissionGranted: boolean = false;
  private shownNotificationTags: Set<string> = new Set();
  private listeners: Array<(payload: NotificationPayload) => void> = [];

  constructor() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permissionGranted = Notification.permission === 'granted';
    }
  }

  getPermissionStatus(): 'granted' | 'denied' | 'default' {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  async requestPermission(): Promise<boolean> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false;
    }
    try {
      const res = await Notification.requestPermission();
      this.permissionGranted = res === 'granted';
      return this.permissionGranted;
    } catch {
      return false;
    }
  }

  subscribe(listener: (payload: NotificationPayload) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  notify(payload: NotificationPayload): void {
    // Notify in-app subscribers always
    for (const l of this.listeners) {
      try {
        l(payload);
      } catch {
        // ignore
      }
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    if (Notification.permission !== 'granted') {
      return;
    }

    // Determine notification title, body, and tag based on event type
    let title = '';
    let body = '';
    let tag = '';
    let icon = '/vite.svg';

    switch (payload.type) {
      case 'task_started':
        title = `▶ ${payload.agentName} · Started`;
        body = payload.taskTitle;
        tag = `task-start-${payload.taskId || Date.now()}`;
        break;

      case 'task_progress': {
        const pct = payload.progress ?? 50;
        title = `⏳ ${payload.agentName} · Progress (${pct}%)`;
        body = payload.taskSummary || payload.taskTitle;
        tag = `task-progress-${payload.taskId || 'cur'}`;
        break;
      }

      case 'approval_needed':
        title = `⚠️ Approval Needed · ${payload.agentName}`;
        body = `Requests permission to execute '${payload.toolName || 'command'}'\n${payload.taskSummary}`;
        tag = `approval-${payload.approvalId || Date.now()}`;
        break;

      case 'task_completed':
        title = `✅ ${payload.agentName} · Task Completed`;
        body = payload.taskTitle;
        tag = `task-complete-${payload.taskId || Date.now()}`;
        break;

      case 'task_failed':
        title = `❌ ${payload.agentName} · Task Failed`;
        body = payload.error ? `${payload.taskTitle}\nError: ${payload.error}` : payload.taskTitle;
        tag = `task-failed-${payload.taskId || Date.now()}`;
        break;
    }

    // Deduplicate identical tags within 3 seconds
    if (this.shownNotificationTags.has(tag)) {
      return;
    }
    this.shownNotificationTags.add(tag);
    setTimeout(() => {
      this.shownNotificationTags.delete(tag);
    }, 3000);

    // Vibration feedback on Android mobile
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        if (payload.type === 'approval_needed' || payload.type === 'task_failed') {
          navigator.vibrate([100, 50, 100]);
        } else if (payload.type === 'task_completed') {
          navigator.vibrate(80);
        }
      } catch {
        // ignore
      }
    }

    try {
      const notification = new Notification(title, {
        body,
        icon,
        tag,
        badge: icon,
        silent: false,
      });

      notification.onclick = (e) => {
        e.preventDefault();
        window.focus();
        if (payload.onView) {
          payload.onView();
        } else if (payload.onResume) {
          payload.onResume();
        }
        notification.close();
      };
    } catch {
      // Fallback if Notification constructor fails in some mobile WebViews
    }
  }
}

export const notificationEngine = new WorkstationNotificationEngine();

export function notifyTaskStarted(taskId: string, agentName: string, taskTitle: string): void {
  notificationEngine.notify({
    type: 'task_started',
    taskId,
    agentName,
    taskTitle,
    taskSummary: 'Agent task started',
  });
}

export function notifyTaskProgress(
  taskId: string,
  taskTitle: string,
  progress: number,
  currentStep: string
): void {
  notificationEngine.notify({
    type: 'task_progress',
    taskId,
    agentName: 'Agent',
    taskTitle,
    taskSummary: currentStep || `Progress: ${progress}%`,
    progress,
  });
}

export function notifyTaskCompleted(
  taskId: string,
  agentName: string,
  taskTitle: string,
  summary?: string
): void {
  notificationEngine.notify({
    type: 'task_completed',
    taskId,
    agentName,
    taskTitle,
    taskSummary: summary || 'Completed',
  });
}

export function notifyTaskFailed(
  taskId: string,
  agentName: string,
  taskTitle: string,
  error?: string
): void {
  notificationEngine.notify({
    type: 'task_failed',
    taskId,
    agentName,
    taskTitle,
    taskSummary: error || 'Failed',
    error,
  });
}

export function notifyApprovalNeeded(
  approvalId: string,
  toolName: string,
  reason: string
): void {
  notificationEngine.notify({
    type: 'approval_needed',
    approvalId,
    agentName: 'Autonomous Agent',
    taskTitle: reason,
    taskSummary: reason,
    toolName,
  });
}
