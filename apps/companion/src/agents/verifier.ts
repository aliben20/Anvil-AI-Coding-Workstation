/**
 * Obsidian Duet Agent - Task Verifier
 * Verifies deliverables, artifacts, and exit codes before task completion.
 * Never claims completion solely based on model assertions.
 */

import fs from 'fs';

export interface VerificationCheck {
  name: string;
  passed: boolean;
  diagnostic: string;
}

export class TaskVerifier {
  public verifyFileExists(filePath: string): VerificationCheck {
    const exists = fs.existsSync(filePath);
    return {
      name: 'file_exists_check',
      passed: exists,
      diagnostic: exists ? `Verified file exists at '${filePath}'.` : `Verification failed: File '${filePath}' was not created.`,
    };
  }

  public verifyCommandExit(exitCode: number | null): VerificationCheck {
    const ok = exitCode === 0;
    return {
      name: 'command_exit_check',
      passed: ok,
      diagnostic: ok ? 'Command exited cleanly with code 0.' : `Command failed with exit code ${exitCode}.`,
    };
  }

  public verifyArtifactNonEmpty(content: string, minLength = 5): VerificationCheck {
    const ok = typeof content === 'string' && content.trim().length >= minLength;
    return {
      name: 'artifact_content_check',
      passed: ok,
      diagnostic: ok ? `Artifact contains ${content.length} characters.` : 'Artifact is empty or incomplete.',
    };
  }
}
