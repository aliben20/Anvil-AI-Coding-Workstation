package io.anvil.workstation.agents

import io.anvil.workstation.core.PermissionCategory
import io.anvil.workstation.core.PermissionPolicy
import io.anvil.workstation.security.PermissionManager
import io.anvil.workstation.workspace.WorkspaceManager
import io.anvil.workstation.workspace.WorkspaceProject

enum class AgentActivityState {
    PLANNING,
    READING_FILE,
    EDITING_FILE,
    RUNNING_COMMAND,
    WAITING_FOR_PERMISSION,
    CALLING_PROVIDER,
    RUNNING_TESTS,
    BUILDING_APK,
    COMPLETED,
    FAILED,
    CANCELLED,
}

data class AgentExecutionLimits(
    val maxIterations: Int = 8,
    val maxToolCalls: Int = 12,
    val commandTimeoutMs: Long = 30_000L,
    val maxOutputBytes: Int = 64 * 1024,
)

data class ToolCallProposal(
    val id: String,
    val toolName: String,
    val arguments: Map<String, String>,
    val permissionCategory: PermissionCategory,
)

data class AgentActivityEvent(
    val id: String,
    val timestampMillis: Long,
    val state: AgentActivityState,
    val description: String,
    val toolInput: String? = null,
    val toolOutput: String? = null,
    val isProposedAction: Boolean = false,
)

interface ToolExecutor {
    suspend fun executeTool(workspace: WorkspaceProject, call: ToolCallProposal): Result<String>
}

interface AgentEngine {
    suspend fun runBoundedTask(
        workspace: WorkspaceProject,
        userPrompt: String,
        limits: AgentExecutionLimits,
        onEvent: (AgentActivityEvent) -> Unit,
        onApprovalRequired: suspend (ToolCallProposal) -> Boolean,
    ): Result<String>
}

class BoundedAgentEngine(
    private val permissionManager: PermissionManager,
    private val toolExecutor: ToolExecutor,
) : AgentEngine {

    override suspend fun runBoundedTask(
        workspace: WorkspaceProject,
        userPrompt: String,
        limits: AgentExecutionLimits,
        onEvent: (AgentActivityEvent) -> Unit,
        onApprovalRequired: suspend (ToolCallProposal) -> Boolean,
    ): Result<String> = runCatching {
        require(limits.maxIterations in 1..25) { "maxIterations must be between 1 and 25" }
        require(limits.maxToolCalls in 1..50) { "maxToolCalls must be between 1 and 50" }

        onEvent(
            AgentActivityEvent(
                id = "plan-1",
                timestampMillis = System.currentTimeMillis(),
                state = AgentActivityState.PLANNING,
                description = "Constructed bounded task plan for workspace '${workspace.name}' (max ${limits.maxIterations} iterations)",
            )
        )
        "Bounded task plan verified for ${workspace.name}"
    }

    suspend fun validateAndExecuteTool(
        workspace: WorkspaceProject,
        proposal: ToolCallProposal,
        onEvent: (AgentActivityEvent) -> Unit,
        onApprovalRequired: suspend (ToolCallProposal) -> Boolean,
    ): Result<String> {
        val policy = permissionManager.getPolicy(proposal.permissionCategory)
        if (policy == PermissionPolicy.DENY) {
            onEvent(
                AgentActivityEvent(
                    id = proposal.id,
                    timestampMillis = System.currentTimeMillis(),
                    state = AgentActivityState.FAILED,
                    description = "Blocked by permission policy: ${proposal.permissionCategory}",
                    toolInput = proposal.arguments.toString(),
                )
            )
            return Result.failure(SecurityException("Permission denied for ${proposal.permissionCategory}"))
        }
        if (policy == PermissionPolicy.ASK) {
            onEvent(
                AgentActivityEvent(
                    id = "${proposal.id}-ask",
                    timestampMillis = System.currentTimeMillis(),
                    state = AgentActivityState.WAITING_FOR_PERMISSION,
                    description = "Waiting for approval to execute ${proposal.toolName}",
                    toolInput = proposal.arguments.toString(),
                    isProposedAction = true,
                )
            )
            val approved = onApprovalRequired(proposal)
            if (!approved) {
                onEvent(
                    AgentActivityEvent(
                        id = "${proposal.id}-cancel",
                        timestampMillis = System.currentTimeMillis(),
                        state = AgentActivityState.CANCELLED,
                        description = "User declined tool execution: ${proposal.toolName}",
                    )
                )
                return Result.failure(SecurityException("User declined approval for ${proposal.toolName}"))
            }
        }
        return toolExecutor.executeTool(workspace, proposal)
    }
}
