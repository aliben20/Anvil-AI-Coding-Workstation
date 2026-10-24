/**
 * Obsidian Duet Agent - Task Planner
 * Distinguishes conversational questions from tool-requiring tasks.
 * Prevents unnecessary delegation loops or canned responses.
 */

import { SpecialistRole } from '../../../../packages/contracts/src/types.js';

export interface PlannedSubtask {
  agentRole: SpecialistRole;
  title: string;
  isReadOnly: boolean;
  input: Record<string, unknown>;
}

export interface PlanResult {
  isPureConversation: boolean;
  subtasks: PlannedSubtask[];
  reasoningSummary: string;
}

export class AgentPlanner {
  /**
   * Plans the execution strategy for a given user prompt.
   * Ordinary questions (math, general knowledge, greetings) return isPureConversation: true.
   */
  public plan(prompt: string, hasActiveNote: boolean): PlanResult {
    const text = prompt.trim();

    // 1. Pure greetings, math, or basic queries -> zero subtasks
    if (/^(hi|hello|hey|greetings|start|thanks|thank you|who are you)[\s.?!]*$/i.test(text)) {
      return {
        isPureConversation: true,
        subtasks: [],
        reasoningSummary: 'Conversational greeting: direct model response.',
      };
    }

    // Pure math or arithmetic expressions (e.g. "What is 7 + 9?", "7+9", "calculate 15 * 8")
    if (
      /^[\d\s+\-*/().^%]+$/.test(text) ||
      /^(?:what is|calculate|solve|eval|evaluate)\s+[\d\s+\-*/().^%]+[?.]*$/i.test(text)
    ) {
      return {
        isPureConversation: true,
        subtasks: [],
        reasoningSummary: 'Pure arithmetic expression: direct model calculation.',
      };
    }

    // Explanatory or conceptual questions (e.g. "Explain what a coroutine is", "What does Obsidian do?")
    if (
      /^(explain|what is|how does|why does|tell me about|summarize the concept of)\b/i.test(text) &&
      !/\b(my notes|this note|workspace|project files|in my vault)\b/i.test(text)
    ) {
      return {
        isPureConversation: true,
        subtasks: [],
        reasoningSummary: 'General explanatory inquiry: direct model knowledge.',
      };
    }

    const subtasks: PlannedSubtask[] = [];

    // 2. Note search or vault research request
    if (/\b(search|find|lookup|research|notes about|vault)\b/i.test(text)) {
      subtasks.push({
        agentRole: 'researcher',
        title: 'Search relevant notes and context in vault',
        isReadOnly: true,
        input: { query: text },
      });
    }

    // 3. Project code or file modification request
    if (/\b(code|build|implement|edit file|modify file|create note|write note|patch)\b/i.test(text)) {
      subtasks.push({
        agentRole: 'coder',
        title: 'Draft requested modifications or code changes',
        isReadOnly: false,
        input: { prompt: text },
      });
      subtasks.push({
        agentRole: 'reviewer',
        title: 'Review proposed diff and verify constraints',
        isReadOnly: true,
        input: { prompt: text },
      });
    } else if (hasActiveNote && /\b(this note|active note|summarize this|review this)\b/i.test(text)) {
      subtasks.push({
        agentRole: 'vault-assistant',
        title: 'Analyze active note context',
        isReadOnly: true,
        input: { prompt: text },
      });
    }

    return {
      isPureConversation: subtasks.length === 0,
      subtasks,
      reasoningSummary: subtasks.length > 0
        ? `Delegated ${subtasks.length} subtask(s) to specialist team.`
        : 'Direct response without subtask delegation.',
    };
  }
}
