package io.anvil.workstation.memory

data class MemoryEntry(
    val id: String,
    val scope: String, // "global" or workspaceId
    val title: String,
    val content: String,
    val updatedAtMillis: Long,
)

interface MemoryStore {
    fun saveNote(scope: String, title: String, content: String): MemoryEntry
    fun search(scope: String?, query: String): List<MemoryEntry>
    fun deleteNote(id: String): Boolean
}

class InMemoryKeywordStore : MemoryStore {
    private val entries = mutableListOf<MemoryEntry>()

    override fun saveNote(scope: String, title: String, content: String): MemoryEntry {
        val entry = MemoryEntry(
            id = "mem-${entries.size + 1}-${System.currentTimeMillis()}",
            scope = scope,
            title = title.trim(),
            content = content.trim(),
            updatedAtMillis = System.currentTimeMillis(),
        )
        entries.removeAll { it.scope == scope && it.title.equals(entry.title, ignoreCase = true) }
        entries += entry
        return entry
    }

    override fun search(scope: String?, query: String): List<MemoryEntry> {
        val terms = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
        return entries
            .filter { scope == null || it.scope == scope || it.scope == "global" }
            .filter { item ->
                if (terms.isEmpty()) true
                else {
                    val hay = "${item.title} ${item.content}".lowercase()
                    terms.all { term -> hay.contains(term) }
                }
            }
            .sortedByDescending { it.updatedAtMillis }
    }

    override fun deleteNote(id: String): Boolean = entries.removeIf { it.id == id }
}
