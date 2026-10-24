package io.anvil.workstation.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.anvil.workstation.R
import io.anvil.workstation.core.PermissionCategory
import io.anvil.workstation.core.PermissionPolicy
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ObsidianNativeApp(vm: WorkstationViewModel) {
    var showNewProjectDialog by remember { mutableStateOf(false) }

    BackHandler(
        enabled = vm.activeScreen == NativeScreen.TOOLS && vm.activeToolsSubTab == ToolsSubTab.WORKSPACES && vm.projectMode != ProjectMode.LIST
    ) {
        vm.backInProjects()
    }

    Scaffold(
        containerColor = ObsidianPalette.Background,
        topBar = { ObsidianTopBar(vm) },
        bottomBar = { ObsidianBottomBar(vm) },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (vm.activeScreen) {
                NativeScreen.CHAT -> ChatScreen(vm)
                NativeScreen.TOOLS -> ToolsHubScreen(vm, onNewProject = { showNewProjectDialog = true })
                NativeScreen.AGENTS -> AgentsScreen(vm)
                NativeScreen.TERMINAL -> TerminalScreen(vm)
                NativeScreen.SETTINGS -> SettingsScreen(vm)
            }
        }
    }

    if (showNewProjectDialog) {
        NewProjectDialog(
            onDismiss = { showNewProjectDialog = false },
            onCreate = { name, template ->
                showNewProjectDialog = false
                vm.createWorkspace(name, template)
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ObsidianTopBar(vm: WorkstationViewModel) {
    TopAppBar(
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = ObsidianPalette.Surface,
            titleContentColor = ObsidianPalette.TextPrimary,
            actionIconContentColor = ObsidianPalette.TextSecondary,
        ),
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.obsidian_crystal_icon),
                    contentDescription = "OBSIDIAN",
                    modifier = Modifier.size(26.dp),
                )
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        text = "OBSIDIAN",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        letterSpacing = 1.4.sp,
                    )
                    Text(
                        text = vm.activeWorkspace?.name ?: "no workspace",
                        color = ObsidianPalette.TextSecondary,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        actions = {
            Surface(
                shape = RoundedCornerShape(6.dp),
                color = ObsidianPalette.SurfaceMuted,
                border = BorderStroke(1.dp, ObsidianPalette.Border),
                modifier = Modifier
                    .padding(end = 10.dp)
                    .clickable { vm.activeScreen = NativeScreen.SETTINGS },
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(
                                if (vm.apiKeyConfigured) ObsidianPalette.Success
                                else ObsidianPalette.Warning
                            )
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = vm.modelId,
                        color = ObsidianPalette.TextPrimary,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
    )
}

@Composable
private fun ObsidianBottomBar(vm: WorkstationViewModel) {
    NavigationBar(
        containerColor = ObsidianPalette.Surface,
        tonalElevation = 0.dp,
    ) {
        NativeScreen.entries.forEach { screen ->
            NavigationBarItem(
                selected = vm.activeScreen == screen,
                onClick = { vm.activeScreen = screen },
                icon = {
                    Icon(
                        imageVector = screen.icon(),
                        contentDescription = screen.label,
                        modifier = Modifier.size(20.dp),
                    )
                },
                label = {
                    Text(screen.label, fontSize = 10.sp)
                },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = ObsidianPalette.Background,
                    selectedTextColor = ObsidianPalette.Accent,
                    indicatorColor = ObsidianPalette.Accent,
                    unselectedIconColor = ObsidianPalette.TextSecondary,
                    unselectedTextColor = ObsidianPalette.TextSecondary,
                ),
            )
        }
    }
}

private fun NativeScreen.icon(): ImageVector = when (this) {
    NativeScreen.CHAT -> Icons.Default.Chat
    NativeScreen.TOOLS -> Icons.Default.Build
    NativeScreen.AGENTS -> Icons.Default.SmartToy
    NativeScreen.TERMINAL -> Icons.Default.Terminal
    NativeScreen.SETTINGS -> Icons.Default.Settings
}

@Composable
private fun ScreenHeader(
    title: String,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Surface(
        color = ObsidianPalette.Surface,
        border = BorderStroke(1.dp, ObsidianPalette.BorderSubtle),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = ObsidianPalette.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        color = ObsidianPalette.TextSecondary,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            actions()
        }
    }
}

@Composable
private fun ChatScreen(vm: WorkstationViewModel) {
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current

    LaunchedEffect(vm.chatMessages.size, vm.chatBusy) {
        val target = if (vm.chatBusy) vm.chatMessages.size else vm.chatMessages.lastIndex
        if (target >= 0) {
            listState.animateScrollToItem(target)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .background(ObsidianPalette.Background)
    ) {
        ScreenHeader(
            title = "Chat",
            subtitle = "${vm.providerDisplayName()} · ${vm.modelId}",
            actions = {
                IconButton(onClick = { vm.clearChat() }) {
                    Icon(Icons.Default.Refresh, contentDescription = "New chat")
                }
            },
        )

        val chatError = vm.chatError
        if (!chatError.isNullOrBlank()) {
            Surface(
                color = Color(0xFF2B1618),
                border = BorderStroke(1.dp, Color(0xFF5C2B2F)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.ErrorOutline,
                        contentDescription = null,
                        tint = ObsidianPalette.Danger,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = chatError,
                        color = ObsidianPalette.Danger,
                        fontSize = 11.sp,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(vm.chatMessages, key = { it.id }) { message ->
                ChatMessageRow(message)
            }
            if (vm.chatBusy) {
                item(key = "typing-indicator") { TypingIndicator() }
            }
            if (vm.chatMessages.size <= 1 && !vm.chatBusy) {
                item(key = "chat-suggestions") { ChatSuggestions(vm) }
            }
        }

        Surface(
            color = ObsidianPalette.Surface,
            border = BorderStroke(1.dp, ObsidianPalette.BorderSubtle),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                OutlinedTextField(
                    value = vm.chatInput,
                    onValueChange = { vm.chatInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Ask OBSIDIAN...", fontSize = 13.sp) },
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
                    maxLines = 5,
                    shape = RoundedCornerShape(8.dp),
                    colors = obsidianFieldColors(),
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = {
                        if (vm.chatBusy) {
                            vm.cancelChat()
                        } else {
                            focusManager.clearFocus()
                            vm.sendChat()
                        }
                    },
                    enabled = vm.chatBusy || vm.chatInput.isNotBlank(),
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(
                            if (vm.chatBusy || vm.chatInput.isNotBlank()) ObsidianPalette.Accent
                            else ObsidianPalette.SurfaceMuted
                        ),
                ) {
                    Icon(
                        imageVector = if (vm.chatBusy) Icons.Default.Stop else Icons.Default.Send,
                        contentDescription = if (vm.chatBusy) "Stop" else "Send",
                        tint = if (vm.chatBusy || vm.chatInput.isNotBlank())
                            ObsidianPalette.Background else ObsidianPalette.TextMuted,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatMessageRow(message: UiChatMessage) {
    val isUser = message.role == "user"
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Text(
            text = if (isUser) "YOU · ${formatTime(message.timeMillis)}" else "OBSIDIAN · ${formatTime(message.timeMillis)}",
            color = if (isUser) ObsidianPalette.AccentDim else ObsidianPalette.TextMuted,
            fontFamily = FontFamily.Monospace,
            fontSize = 9.sp,
            letterSpacing = 0.5.sp,
            modifier = Modifier.padding(horizontal = 2.dp, vertical = 3.dp),
        )
        Surface(
            shape = RoundedCornerShape(
                topStart = 10.dp,
                topEnd = 10.dp,
                bottomStart = if (isUser) 10.dp else 2.dp,
                bottomEnd = if (isUser) 2.dp else 10.dp,
            ),
            color = if (isUser) ObsidianPalette.Accent else ObsidianPalette.Surface,
            contentColor = if (isUser) ObsidianPalette.Background else ObsidianPalette.TextPrimary,
            border = if (isUser) null else BorderStroke(1.dp, ObsidianPalette.Border),
            modifier = Modifier.fillMaxWidth(if (isUser) 0.9f else 1f),
        ) {
            Text(
                text = message.text,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                fontSize = 13.sp,
                lineHeight = 19.sp,
            )
        }
    }
}

@Composable
private fun TypingIndicator() {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(ObsidianPalette.Surface)
            .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(14.dp),
            strokeWidth = 1.5.dp,
            color = ObsidianPalette.Accent,
        )
        Spacer(Modifier.width(9.dp))
        Text(
            text = "OBSIDIAN is thinking...",
            color = ObsidianPalette.TextSecondary,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun ChatSuggestions(vm: WorkstationViewModel) {
    val suggestions = listOf(
        "Explain this workspace",
        "Plan a new feature",
        "Review my project structure",
        "Help me debug an error",
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "SUGGESTED PROMPTS",
            color = ObsidianPalette.TextMuted,
            fontFamily = FontFamily.Monospace,
            fontSize = 9.sp,
            letterSpacing = 1.sp,
        )
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            suggestions.forEach { suggestion ->
                AssistChip(
                    onClick = {
                        vm.chatInput = suggestion
                        vm.sendChat()
                    },
                    label = { Text(suggestion, fontSize = 11.sp) },
                    colors = AssistChipDefaults.assistChipColors(
                        containerColor = ObsidianPalette.Surface,
                        labelColor = ObsidianPalette.TextPrimary,
                    ),
                    border = AssistChipDefaults.assistChipBorder(
                        enabled = true,
                        borderColor = ObsidianPalette.Border,
                    ),
                )
            }
        }
    }
}

@Composable
private fun ToolsHubScreen(vm: WorkstationViewModel, onNewProject: () -> Unit) {
    Column(Modifier.fillMaxSize().background(ObsidianPalette.Background)) {
        Surface(
            color = ObsidianPalette.Surface,
            border = BorderStroke(1.dp, ObsidianPalette.BorderSubtle),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ToolsSubTab.entries.forEach { tab ->
                    FilterChip(
                        selected = vm.activeToolsSubTab == tab,
                        onClick = { vm.activeToolsSubTab = tab },
                        label = { Text(tab.label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold) },
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = ObsidianPalette.Background,
                            labelColor = ObsidianPalette.TextSecondary,
                            selectedContainerColor = ObsidianPalette.Accent,
                            selectedLabelColor = ObsidianPalette.Background,
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = vm.activeToolsSubTab == tab,
                            borderColor = ObsidianPalette.Border,
                            selectedBorderColor = ObsidianPalette.Accent,
                        ),
                    )
                }
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (vm.activeToolsSubTab) {
                ToolsSubTab.SKILLS -> SkillsSubScreen(vm)
                ToolsSubTab.WORKSPACES -> ProjectsScreen(vm, onNewProject)
                ToolsSubTab.IMAGES -> ImagesSubScreen(vm)
                ToolsSubTab.MODELS -> ModelsSubScreen(vm)
                ToolsSubTab.TOOLCHAINS -> ToolchainsSubScreen(vm)
            }
        }
    }
}

@Composable
private fun SkillsSubScreen(vm: WorkstationViewModel) {
    var inspectedSkill by remember { mutableStateOf<NativeSkill?>(null) }
    var showCreateSkillDialog by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = "Skills Library",
            subtitle = "${vm.skills.count { it.enabled }}/${vm.skills.size} active · SKILL.md playbooks",
            actions = {
                IconButton(onClick = { showCreateSkillDialog = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Create skill")
                }
            },
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(vm.skills, key = { it.id }) { skill ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { inspectedSkill = skill },
                    colors = CardDefaults.cardColors(containerColor = ObsidianPalette.Surface),
                    border = BorderStroke(1.dp, ObsidianPalette.Border),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = skill.category.uppercase(Locale.getDefault()),
                                color = ObsidianPalette.Accent,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 9.sp,
                                modifier = Modifier
                                    .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(4.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = skill.name,
                                color = ObsidianPalette.TextPrimary,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp,
                                modifier = Modifier.weight(1f),
                            )
                            Switch(
                                checked = skill.enabled,
                                onCheckedChange = { vm.toggleSkill(skill.id) },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = ObsidianPalette.Background,
                                    checkedTrackColor = ObsidianPalette.Accent,
                                ),
                            )
                        }
                        Text(
                            text = skill.description,
                            color = ObsidianPalette.TextSecondary,
                            fontSize = 12.sp,
                        )
                        if (skill.tools.isNotEmpty()) {
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                skill.tools.forEach { toolName ->
                                    Text(
                                        text = toolName,
                                        color = ObsidianPalette.TextPrimary,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 10.sp,
                                        modifier = Modifier
                                            .background(ObsidianPalette.Background, RoundedCornerShape(4.dp))
                                            .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(4.dp))
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    inspectedSkill?.let { skill ->
        AlertDialog(
            onDismissRequest = { inspectedSkill = null },
            containerColor = ObsidianPalette.Surface,
            title = {
                Text(skill.name, color = ObsidianPalette.TextPrimary, fontWeight = FontWeight.Bold)
            },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(skill.description, color = ObsidianPalette.TextSecondary, fontSize = 12.sp)
                    Text(
                        text = skill.instructions,
                        color = ObsidianPalette.TextPrimary,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(ObsidianPalette.Background, RoundedCornerShape(8.dp))
                            .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(8.dp))
                            .padding(10.dp),
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { inspectedSkill = null }) {
                    Text("Close", color = ObsidianPalette.Accent)
                }
            },
        )
    }

    if (showCreateSkillDialog) {
        var name by remember { mutableStateOf("") }
        var desc by remember { mutableStateOf("") }
        var category by remember { mutableStateOf("code") }
        var tools by remember { mutableStateOf("read_file, write_file") }
        var instructions by remember { mutableStateOf("# Instructions\n1. Inspect target files.\n2. Apply verified changes.") }

        AlertDialog(
            onDismissRequest = { showCreateSkillDialog = false },
            containerColor = ObsidianPalette.Surface,
            title = { Text("Create Agent Skill", color = ObsidianPalette.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Skill Name") },
                        singleLine = true,
                        colors = obsidianFieldColors(),
                    )
                    OutlinedTextField(
                        value = desc,
                        onValueChange = { desc = it },
                        label = { Text("Description") },
                        colors = obsidianFieldColors(),
                    )
                    OutlinedTextField(
                        value = tools,
                        onValueChange = { tools = it },
                        label = { Text("Declared Tools (comma-separated)") },
                        singleLine = true,
                        colors = obsidianFieldColors(),
                    )
                    OutlinedTextField(
                        value = instructions,
                        onValueChange = { instructions = it },
                        label = { Text("SKILL.md Instructions") },
                        maxLines = 5,
                        colors = obsidianFieldColors(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        vm.createCustomSkill(name, name, desc, category, tools, instructions)
                        showCreateSkillDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ObsidianPalette.Accent,
                        contentColor = ObsidianPalette.Background,
                    ),
                ) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateSkillDialog = false }) {
                    Text("Cancel", color = ObsidianPalette.TextSecondary)
                }
            },
        )
    }
}

@Composable
private fun ImagesSubScreen(vm: WorkstationViewModel) {
    val ratios = listOf("1:1", "16:9", "9:16", "4:3")
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = "Image Studio",
            subtitle = "Prompt & aspect ratio configuration · ${vm.modelId}",
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ratios.forEach { ratio ->
                    FilterChip(
                        selected = vm.imageAspectRatio == ratio,
                        onClick = { vm.imageAspectRatio = ratio },
                        label = { Text(ratio, fontSize = 11.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = ObsidianPalette.Surface,
                            labelColor = ObsidianPalette.TextSecondary,
                            selectedContainerColor = ObsidianPalette.Accent,
                            selectedLabelColor = ObsidianPalette.Background,
                        ),
                    )
                }
            }
            OutlinedTextField(
                value = vm.imagePrompt,
                onValueChange = { vm.imagePrompt = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Describe the UI asset, icon, or diagram to generate...", fontSize = 12.sp) },
                maxLines = 4,
                colors = obsidianFieldColors(),
            )
            Button(
                onClick = { vm.generateImageSpec() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = ObsidianPalette.Accent,
                    contentColor = ObsidianPalette.Background,
                ),
            ) {
                Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Queue Image Generation", fontWeight = FontWeight.SemiBold)
            }
        }
        HorizontalDivider(color = ObsidianPalette.BorderSubtle)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(vm.generatedImageRecords) { item ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = ObsidianPalette.Surface),
                    border = BorderStroke(1.dp, ObsidianPalette.Border),
                ) {
                    Text(
                        text = item,
                        color = ObsidianPalette.TextPrimary,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ModelsSubScreen(vm: WorkstationViewModel) {
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = "AI Models",
            subtitle = "Active: ${vm.providerDisplayName()} · ${vm.modelId}",
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(vm.modelCatalog, key = { "${it.providerId}:${it.modelId}" }) { entry ->
                val isSelected = vm.providerId == entry.providerId && vm.modelId == entry.modelId
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            val opt = WorkstationViewModel.providerOption(entry.providerId)
                            vm.saveProviderSettings(entry.providerId, entry.modelId, opt.defaultBaseUrl)
                        },
                    colors = CardDefaults.cardColors(containerColor = ObsidianPalette.Surface),
                    border = BorderStroke(
                        1.dp,
                        if (isSelected) ObsidianPalette.Accent else ObsidianPalette.Border,
                    ),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = entry.modelId,
                                color = ObsidianPalette.TextPrimary,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 14.sp,
                            )
                            Text(
                                text = "${entry.providerLabel} · ${entry.contextWindow}",
                                color = ObsidianPalette.Accent,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 10.sp,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = entry.description,
                                color = ObsidianPalette.TextSecondary,
                                fontSize = 12.sp,
                            )
                        }
                        if (isSelected) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = "Active",
                                tint = ObsidianPalette.Accent,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolchainsSubScreen(vm: WorkstationViewModel) {
    val items = listOf(
        Triple("Android Build Pipeline", "AAPT2 · D8 · ZipAlign · APK Signer", "READY"),
        Triple("On-Device Shell & PTY", "Persistent Android process session (${vm.terminalModeLabel})", "ACTIVE"),
        Triple("Workspace File Engine", "${vm.workspaces.size} local project(s) mounted", "MOUNTED"),
        Triple("Skills Runtime Engine", "${vm.skills.count { it.enabled }} active SKILL.md playbooks", "ENABLED"),
    )
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = "Toolchains & Runtime",
            subtitle = "Workstation execution subsystems",
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(items) { (name, detail, badge) ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = ObsidianPalette.Surface),
                    border = BorderStroke(1.dp, ObsidianPalette.Border),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(name, color = ObsidianPalette.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            Text(detail, color = ObsidianPalette.TextSecondary, fontFamily = FontFamily.Monospace, fontSize = 11.sp)
                        }
                        Text(
                            text = badge,
                            color = ObsidianPalette.Accent,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.sp,
                            modifier = Modifier
                                .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(4.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectsScreen(vm: WorkstationViewModel, onNewProject: () -> Unit) {
    when (vm.projectMode) {
        ProjectMode.LIST -> ProjectListScreen(vm, onNewProject)
        ProjectMode.TREE -> ProjectTreeScreen(vm)
        ProjectMode.EDITOR -> ProjectEditorScreen(vm)
    }
}

@Composable
private fun ProjectListScreen(vm: WorkstationViewModel, onNewProject: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = "Projects",
            subtitle = "${vm.workspaces.size} workspace${if (vm.workspaces.size == 1) "" else "s"} · on-device",
            actions = {
                IconButton(onClick = onNewProject) {
                    Icon(Icons.Default.Add, contentDescription = "New project")
                }
            },
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (vm.workspaces.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.Default.Folder,
                        title = "No projects yet",
                        body = "Create a workspace to start editing files on-device.",
                    )
                }
            }
            items(vm.workspaces, key = { it.id }) { workspace ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { vm.openWorkspace(workspace) },
                    colors = CardDefaults.cardColors(containerColor = ObsidianPalette.Surface),
                    border = BorderStroke(1.dp, ObsidianPalette.Border),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(38.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(ObsidianPalette.SurfaceMuted),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = workspaceIcon(workspace.templateType),
                                contentDescription = null,
                                tint = ObsidianPalette.Accent,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = workspace.name,
                                color = ObsidianPalette.TextPrimary,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp,
                            )
                            Spacer(Modifier.height(3.dp))
                            Text(
                                text = "${workspace.templateType} · ${formatRelative(workspace.updatedAtMillis)}",
                                color = ObsidianPalette.TextSecondary,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 10.sp,
                            )
                        }
                        if (vm.activeWorkspace?.id == workspace.id) {
                            Text(
                                text = "ACTIVE",
                                color = ObsidianPalette.Accent,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 9.sp,
                                modifier = Modifier
                                    .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(4.dp))
                                    .padding(horizontal = 6.dp, vertical = 3.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectTreeScreen(vm: WorkstationViewModel) {
    Column(Modifier.fillMaxSize()) {
        val workspace = vm.selectedWorkspace
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ObsidianPalette.Surface)
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { vm.backInProjects() }) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = workspace?.name ?: "Project",
                    color = ObsidianPalette.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
                Text(
                    text = "${vm.projectFiles.size} entries · tap a file to edit",
                    color = ObsidianPalette.TextSecondary,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                )
            }
            IconButton(onClick = { vm.refreshProjectFiles() }) {
                Icon(Icons.Default.Refresh, contentDescription = "Refresh files")
            }
        }
        HorizontalDivider(color = ObsidianPalette.BorderSubtle)
        if (vm.projectFiles.isEmpty()) {
            EmptyState(
                icon = Icons.Default.Folder,
                title = "Empty workspace",
                body = "This project has no readable files yet.",
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 6.dp),
            ) {
                items(vm.projectFiles, key = { it.path }) { entry ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !entry.isDirectory) { vm.openFile(entry) }
                            .padding(
                                start = (12 + entry.depth * 14).dp,
                                end = 12.dp,
                                top = 7.dp,
                                bottom = 7.dp,
                            ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = if (entry.isDirectory) Icons.Default.Folder else fileIcon(entry.name),
                            contentDescription = null,
                            tint = if (entry.isDirectory) ObsidianPalette.Warning else ObsidianPalette.Info,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = entry.name,
                            color = if (entry.isDirectory) ObsidianPalette.TextPrimary else ObsidianPalette.TextSecondary,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            fontWeight = if (entry.isDirectory) FontWeight.SemiBold else FontWeight.Normal,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectEditorScreen(vm: WorkstationViewModel) {
    val focusManager = LocalFocusManager.current
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ObsidianPalette.Surface)
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { vm.backInProjects() }) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = vm.openFilePath?.substringAfterLast('/') ?: "File",
                    color = ObsidianPalette.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = vm.openFilePath.orEmpty(),
                    color = ObsidianPalette.TextSecondary,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (vm.editorDirty) {
                Box(
                    Modifier
                        .padding(end = 8.dp)
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(ObsidianPalette.Warning)
                )
            }
            IconButton(onClick = {
                focusManager.clearFocus()
                vm.saveEditor()
            }) {
                Icon(Icons.Default.Save, contentDescription = "Save file", tint = ObsidianPalette.Accent)
            }
        }
        HorizontalDivider(color = ObsidianPalette.BorderSubtle)

        vm.editorMessage?.let { message ->
            Surface(
                color = Color(0xFF122017),
                border = BorderStroke(1.dp, Color(0xFF23402C)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = message,
                    color = ObsidianPalette.Success,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }
        }

        OutlinedTextField(
            value = vm.editorContent,
            onValueChange = { vm.updateEditorContent(it) },
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(10.dp),
            textStyle = MaterialTheme.typography.bodySmall.copy(
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 18.sp,
                color = ObsidianPalette.TextPrimary,
            ),
            shape = RoundedCornerShape(8.dp),
            colors = obsidianFieldColors(),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ObsidianPalette.Surface)
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "${vm.editorContent.count { it == '\n' } + 1} lines · ${vm.editorContent.length} chars",
                color = ObsidianPalette.TextMuted,
                fontFamily = FontFamily.Monospace,
                fontSize = 9.sp,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = if (vm.editorDirty) "UNSAVED" else "SAVED",
                color = if (vm.editorDirty) ObsidianPalette.Warning else ObsidianPalette.Success,
                fontFamily = FontFamily.Monospace,
                fontSize = 9.sp,
                letterSpacing = 0.5.sp,
            )
        }
    }
}

@Composable
private fun AgentsScreen(vm: WorkstationViewModel) {
    Column(Modifier.fillMaxSize().imePadding()) {
        ScreenHeader(
            title = "Agents",
            subtitle = "${vm.agentRoles.size} roles · bounded native subagents",
            actions = {
                if (vm.agentBusy) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 1.5.dp,
                        color = ObsidianPalette.Accent,
                    )
                }
            },
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                vm.agentRoles.forEach { role ->
                    FilterChip(
                        selected = vm.selectedRole == role,
                        onClick = { vm.selectedRole = role },
                        label = { Text(role, fontSize = 11.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = ObsidianPalette.Surface,
                            labelColor = ObsidianPalette.TextSecondary,
                            selectedContainerColor = ObsidianPalette.Accent,
                            selectedLabelColor = ObsidianPalette.Background,
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = vm.selectedRole == role,
                            borderColor = ObsidianPalette.Border,
                            selectedBorderColor = ObsidianPalette.Accent,
                        ),
                    )
                }
            }
            OutlinedTextField(
                value = vm.agentPrompt,
                onValueChange = { vm.agentPrompt = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Describe the task for the ${vm.selectedRole.lowercase()}...", fontSize = 12.sp) },
                textStyle = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                maxLines = 4,
                shape = RoundedCornerShape(8.dp),
                colors = obsidianFieldColors(),
            )
            Button(
                onClick = { vm.runAgentTask() },
                enabled = !vm.agentBusy && vm.agentPrompt.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = ObsidianPalette.Accent,
                    contentColor = ObsidianPalette.Background,
                    disabledContainerColor = ObsidianPalette.SurfaceMuted,
                    disabledContentColor = ObsidianPalette.TextMuted,
                ),
            ) {
                Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Run ${vm.selectedRole}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        HorizontalDivider(color = ObsidianPalette.BorderSubtle)

        if (vm.agentTasks.isEmpty()) {
            EmptyState(
                icon = Icons.Default.SmartToy,
                title = "No agent runs yet",
                body = "Pick a role, describe a task, and the subagent will analyze the active workspace.",
            )
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(vm.agentTasks, key = { it.id }) { task ->
                    AgentTaskCard(task)
                }
            }
        }
    }
}

@Composable
private fun AgentTaskCard(task: AgentTask) {
    val statusColor = when (task.status) {
        AgentTaskStatus.RUNNING -> ObsidianPalette.Info
        AgentTaskStatus.COMPLETED -> ObsidianPalette.Success
        AgentTaskStatus.FAILED -> ObsidianPalette.Danger
    }
    Surface(
        color = ObsidianPalette.Surface,
        border = BorderStroke(1.dp, ObsidianPalette.Border),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = task.role.uppercase(Locale.getDefault()),
                    color = ObsidianPalette.Accent,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    letterSpacing = 0.6.sp,
                    modifier = Modifier
                        .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = task.status.name,
                    color = statusColor,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    letterSpacing = 0.5.sp,
                )
                Spacer(Modifier.weight(1f))
                if (task.status == AgentTaskStatus.RUNNING) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(13.dp),
                        strokeWidth = 1.5.dp,
                        color = ObsidianPalette.Accent,
                    )
                }
            }
            Text(
                text = task.prompt,
                color = ObsidianPalette.TextPrimary,
                fontSize = 12.sp,
                lineHeight = 17.sp,
            )
            if (task.events.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    task.events.takeLast(8).forEach { event ->
                        Text(
                            text = "· $event",
                            color = ObsidianPalette.TextMuted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 9.sp,
                        )
                    }
                }
            }
            if (task.result.isNotBlank()) {
                HorizontalDivider(color = ObsidianPalette.BorderSubtle)
                Text(
                    text = task.result,
                    color = ObsidianPalette.TextSecondary,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                )
            }
            task.error?.let { error ->
                Text(
                    text = error,
                    color = ObsidianPalette.Danger,
                    fontSize = 11.sp,
                )
            }
        }
    }
}

@Composable
private fun TerminalScreen(vm: WorkstationViewModel) {
    val scrollState = rememberScrollState()
    val focusManager = LocalFocusManager.current

    LaunchedEffect(Unit) { vm.ensureTerminalStarted() }
    LaunchedEffect(vm.terminalOutput) {
        withFrameNanos { }
        scrollState.scrollTo(scrollState.maxValue)
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        ScreenHeader(
            title = "Terminal",
            subtitle = "${vm.activeWorkspace?.name ?: "workspace"} · ${vm.terminalModeLabel}",
            actions = {
                IconButton(onClick = { vm.restartTerminal() }) {
                    Icon(Icons.Default.Refresh, contentDescription = "Restart shell")
                }
                IconButton(onClick = { vm.sendTerminalInterrupt() }) {
                    Icon(Icons.Default.Stop, contentDescription = "Send Ctrl+C")
                }
                IconButton(onClick = { vm.clearTerminal() }) {
                    Icon(Icons.Default.Clear, contentDescription = "Clear terminal")
                }
                IconButton(onClick = { vm.stopTerminal() }) {
                    Icon(Icons.Default.Stop, contentDescription = "Stop shell", tint = ObsidianPalette.Danger)
                }
            },
        )

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(10.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(ObsidianPalette.BackgroundDeep)
                .border(1.dp, ObsidianPalette.Border, RoundedCornerShape(8.dp))
                .verticalScroll(scrollState)
                .padding(12.dp),
        ) {
            Text(
                text = vm.terminalOutput.ifEmpty {
                    if (vm.terminalRunning) "Starting shell...\n$ " else "Shell is stopped."
                },
                color = Color(0xFFD7E2EE),
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                lineHeight = 16.sp,
            )
        }

        Surface(
            color = ObsidianPalette.Surface,
            border = BorderStroke(1.dp, ObsidianPalette.BorderSubtle),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "$",
                    color = ObsidianPalette.Accent,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 14.sp,
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = vm.terminalInput,
                    onValueChange = { vm.terminalInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text(
                            if (vm.terminalRunning) "Run a shell command..." else "Start the shell first",
                            fontSize = 12.sp,
                        )
                    },
                    textStyle = MaterialTheme.typography.bodySmall.copy(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                    ),
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
                    colors = obsidianFieldColors(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        focusManager.clearFocus()
                        vm.sendTerminalCommand()
                    }),
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = {
                        focusManager.clearFocus()
                        vm.sendTerminalCommand()
                    },
                    enabled = vm.terminalRunning && vm.terminalInput.isNotBlank(),
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(ObsidianPalette.Accent),
                ) {
                    Icon(
                        Icons.Default.Send,
                        contentDescription = "Run command",
                        tint = ObsidianPalette.Background,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(vm: WorkstationViewModel) {
    var provider by remember(vm.providerId) { mutableStateOf(vm.providerId) }
    var model by remember(vm.modelId) { mutableStateOf(vm.modelId) }
    var endpoint by remember(vm.baseUrl) { mutableStateOf(vm.baseUrl) }
    var apiKeyInput by remember { mutableStateOf("") }
    var keyVisible by remember { mutableStateOf(false) }
    val providerOption = WorkstationViewModel.providerOption(provider)

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(
            title = "Settings",
            subtitle = "native engine · on-device",
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                SectionCard(title = "MODEL PROVIDER") {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        WorkstationViewModel.PROVIDERS.forEach { option ->
                            FilterChip(
                                selected = provider == option.id,
                                onClick = {
                                    provider = option.id
                                    model = option.defaultModel
                                    endpoint = option.defaultBaseUrl
                                    apiKeyInput = ""
                                },
                                label = { Text(option.label, fontSize = 11.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    containerColor = ObsidianPalette.SurfaceMuted,
                                    labelColor = ObsidianPalette.TextSecondary,
                                    selectedContainerColor = ObsidianPalette.Accent,
                                    selectedLabelColor = ObsidianPalette.Background,
                                ),
                                border = FilterChipDefaults.filterChipBorder(
                                    enabled = true,
                                    selected = provider == option.id,
                                    borderColor = ObsidianPalette.Border,
                                    selectedBorderColor = ObsidianPalette.Accent,
                                ),
                            )
                        }
                    }
                    SettingsTextField(
                        value = endpoint,
                        onValueChange = { endpoint = it },
                        label = "Endpoint base URL",
                        placeholder = providerOption.defaultBaseUrl,
                    )
                    SettingsTextField(
                        value = model,
                        onValueChange = { model = it },
                        label = "Model ID",
                        placeholder = providerOption.defaultModel,
                    )
                    Button(
                        onClick = { vm.saveProviderSettings(provider, model, endpoint) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ObsidianPalette.SurfaceMuted,
                            contentColor = ObsidianPalette.TextPrimary,
                        ),
                    ) {
                        Text("Save provider settings", fontSize = 12.sp)
                    }
                }
            }

            item {
                SectionCard(title = "API KEY") {
                    Text(
                        text = if (vm.apiKeyConfigured)
                            "Connected · ${vm.maskedKeyPreview.ifBlank { "key saved" }}"
                        else "No key saved for ${WorkstationViewModel.providerOption(vm.providerId).label}",
                        color = if (vm.apiKeyConfigured) ObsidianPalette.Success else ObsidianPalette.TextSecondary,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                    )
                    OutlinedTextField(
                        value = apiKeyInput,
                        onValueChange = { apiKeyInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("API key", fontSize = 11.sp) },
                        placeholder = { Text("Paste a provider key", fontSize = 11.sp) },
                        textStyle = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                        ),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                        colors = obsidianFieldColors(),
                        visualTransformation = if (keyVisible) VisualTransformation.None
                        else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { keyVisible = !keyVisible }) {
                                Icon(
                                    imageVector = if (keyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = if (keyVisible) "Hide key" else "Show key",
                                    tint = ObsidianPalette.TextSecondary,
                                )
                            }
                        },
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                vm.saveProviderSettings(provider, model, endpoint)
                                vm.saveApiKey(apiKeyInput)
                                apiKeyInput = ""
                            },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = ObsidianPalette.Accent,
                                contentColor = ObsidianPalette.Background,
                            ),
                        ) {
                            Text("Save key", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Text(
                        text = "Keys are encrypted with the Android Keystore. Nothing is bundled in the APK.",
                        color = ObsidianPalette.TextMuted,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                    )
                }
            }

            item {
                SectionCard(title = "OVERLAY CHAT HEAD") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = "Messenger-style floating bubble",
                                color = ObsidianPalette.TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = if (vm.overlayPermissionGranted)
                                    "Display over other apps: granted"
                                else "Display over other apps: not granted",
                                color = if (vm.overlayPermissionGranted) ObsidianPalette.Success
                                else ObsidianPalette.TextSecondary,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 10.sp,
                            )
                        }
                        Switch(
                            checked = vm.overlayEnabled,
                            onCheckedChange = { vm.changeOverlayEnabled(it) },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = ObsidianPalette.Background,
                                checkedTrackColor = ObsidianPalette.Accent,
                                uncheckedThumbColor = ObsidianPalette.TextSecondary,
                                uncheckedTrackColor = ObsidianPalette.SurfaceMuted,
                                uncheckedBorderColor = ObsidianPalette.Border,
                            ),
                        )
                    }
                    Text(
                        text = "Drag the bubble anywhere over other apps. Tap it to reopen OBSIDIAN. A low-priority notification keeps the overlay service alive.",
                        color = ObsidianPalette.TextSecondary,
                        fontSize = 10.sp,
                        lineHeight = 15.sp,
                    )
                    TextButton(onClick = { vm.openOverlaySettings() }) {
                        Text("Open system overlay settings", fontSize = 11.sp, color = ObsidianPalette.Accent)
                    }
                }
            }

            item {
                SectionCard(title = "AGENT PERMISSIONS") {
                    val version = vm.permissionsVersion
                    val categories = listOf(
                        PermissionCategory.MODIFY_FILES,
                        PermissionCategory.EXECUTE_COMMANDS,
                        PermissionCategory.NETWORK_ACCESS,
                        PermissionCategory.BUILD_PROJECTS,
                    )
                    categories.forEach { category ->
                        @Suppress("UNUSED_EXPRESSION")
                        version
                        PermissionPolicyRow(
                            category = category,
                            selected = vm.policyFor(category),
                            onSelect = { vm.setPolicy(category, it) },
                        )
                    }
                    Text(
                        text = "Policies are applied by the native agent/tool engine. Read access stays allowed inside the workspace sandbox.",
                        color = ObsidianPalette.TextMuted,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                    )
                }
            }

            item {
                SectionCard(title = "ABOUT") {
                    InfoRow("Edition", "Native Compose")
                    InfoRow("Engine", "OBSIDIAN offline-first")
                    InfoRow("Provider", vm.providerDisplayName())
                    InfoRow("Model", vm.modelId)
                    InfoRow("Workspace root", "app-private files/workspaces")
                    Text(
                        text = "This build has no WebView and no bundled server. Network calls go only to the provider endpoint you configure.",
                        color = ObsidianPalette.TextMuted,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun PermissionPolicyRow(
    category: PermissionCategory,
    selected: PermissionPolicy,
    onSelect: (PermissionPolicy) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            text = category.name.replace('_', ' '),
            color = ObsidianPalette.TextPrimary,
            fontFamily = FontFamily.Monospace,
            fontSize = 10.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PermissionPolicy.entries.forEach { policy ->
                FilterChip(
                    selected = selected == policy,
                    onClick = { onSelect(policy) },
                    label = { Text(policy.name.lowercase().replaceFirstChar { it.uppercase() }, fontSize = 10.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        containerColor = ObsidianPalette.SurfaceMuted,
                        labelColor = ObsidianPalette.TextSecondary,
                        selectedContainerColor = when (policy) {
                            PermissionPolicy.ALLOW -> ObsidianPalette.Accent
                            PermissionPolicy.ASK -> ObsidianPalette.Warning
                            PermissionPolicy.DENY -> ObsidianPalette.Danger
                        },
                        selectedLabelColor = ObsidianPalette.Background,
                    ),
                    border = FilterChipDefaults.filterChipBorder(
                        enabled = true,
                        selected = selected == policy,
                        borderColor = ObsidianPalette.Border,
                        selectedBorderColor = Color.Transparent,
                    ),
                )
            }
        }
    }
}

@Composable
private fun NewProjectDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var template by remember { mutableStateOf("general") }
    val templates = listOf(
        "general" to "General",
        "kotlin-android" to "Android",
        "python" to "Python",
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = ObsidianPalette.Surface,
        titleContentColor = ObsidianPalette.TextPrimary,
        textContentColor = ObsidianPalette.TextSecondary,
        title = { Text("New project", fontSize = 17.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Project name", fontSize = 11.sp) },
                    placeholder = { Text("my-android-app", fontSize = 11.sp) },
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
                    colors = obsidianFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    text = "TEMPLATE",
                    color = ObsidianPalette.TextMuted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    letterSpacing = 1.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    templates.forEach { (id, label) ->
                        FilterChip(
                            selected = template == id,
                            onClick = { template = id },
                            label = { Text(label, fontSize = 11.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                containerColor = ObsidianPalette.SurfaceMuted,
                                labelColor = ObsidianPalette.TextSecondary,
                                selectedContainerColor = ObsidianPalette.Accent,
                                selectedLabelColor = ObsidianPalette.Background,
                            ),
                            border = FilterChipDefaults.filterChipBorder(
                                enabled = true,
                                selected = template == id,
                                borderColor = ObsidianPalette.Border,
                                selectedBorderColor = ObsidianPalette.Accent,
                            ),
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onCreate(name, template) },
                enabled = name.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = ObsidianPalette.Accent,
                    contentColor = ObsidianPalette.Background,
                    disabledContainerColor = ObsidianPalette.SurfaceMuted,
                    disabledContentColor = ObsidianPalette.TextMuted,
                ),
            ) {
                Text("Create", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = ObsidianPalette.TextSecondary, fontSize = 12.sp)
            }
        },
    )
}

@Composable
private fun SectionCard(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = ObsidianPalette.Surface,
        border = BorderStroke(1.dp, ObsidianPalette.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(13.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(
                text = title,
                color = ObsidianPalette.TextMuted,
                fontFamily = FontFamily.Monospace,
                fontSize = 9.sp,
                letterSpacing = 1.sp,
            )
            content()
        }
    }
}

@Composable
private fun SettingsTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label, fontSize = 11.sp) },
        placeholder = { Text(placeholder, fontSize = 11.sp) },
        textStyle = MaterialTheme.typography.bodySmall.copy(
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
        ),
        singleLine = true,
        shape = RoundedCornerShape(8.dp),
        colors = obsidianFieldColors(),
    )
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            color = ObsidianPalette.TextSecondary,
            fontSize = 11.sp,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            color = ObsidianPalette.TextPrimary,
            fontFamily = FontFamily.Monospace,
            fontSize = 10.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun EmptyState(icon: ImageVector, title: String, body: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 28.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(ObsidianPalette.SurfaceMuted),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = ObsidianPalette.Accent, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = title,
            color = ObsidianPalette.TextPrimary,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = body,
            color = ObsidianPalette.TextSecondary,
            fontSize = 11.sp,
            lineHeight = 16.sp,
        )
    }
}

@Composable
private fun obsidianFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = ObsidianPalette.Accent,
    unfocusedBorderColor = ObsidianPalette.Border,
    disabledBorderColor = ObsidianPalette.BorderSubtle,
    cursorColor = ObsidianPalette.Accent,
    focusedTextColor = ObsidianPalette.TextPrimary,
    unfocusedTextColor = ObsidianPalette.TextPrimary,
    focusedContainerColor = ObsidianPalette.Surface,
    unfocusedContainerColor = ObsidianPalette.Surface,
    disabledContainerColor = ObsidianPalette.Surface,
    focusedLabelColor = ObsidianPalette.Accent,
    unfocusedLabelColor = ObsidianPalette.TextSecondary,
    focusedPlaceholderColor = ObsidianPalette.TextMuted,
    unfocusedPlaceholderColor = ObsidianPalette.TextMuted,
)

private fun workspaceIcon(templateType: String): ImageVector = when {
    templateType.contains("android") -> Icons.Default.Code
    templateType.contains("python") -> Icons.Default.Terminal
    else -> Icons.Default.Folder
}

private fun fileIcon(fileName: String): ImageVector = when {
    fileName.endsWith(".kt") || fileName.endsWith(".java") -> Icons.Default.Code
    fileName.endsWith(".gradle") || fileName.endsWith(".kts") || fileName.endsWith(".xml") -> Icons.Default.Build
    fileName.endsWith(".md") || fileName.endsWith(".txt") -> Icons.Default.Description
    else -> Icons.Default.Description
}

private fun formatTime(millis: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(millis))

private fun formatRelative(millis: Long): String {
    val delta = System.currentTimeMillis() - millis
    return when {
        delta < 60_000 -> "just now"
        delta < 3_600_000 -> "${delta / 60_000}m ago"
        delta < 86_400_000 -> "${delta / 3_600_000}h ago"
        else -> SimpleDateFormat("MMM d", Locale.getDefault()).format(Date(millis))
    }
}
