# LLM Wiki Schema

This is an LLM-maintained knowledge base following the pattern described by
Andrej Karpathy. The LLM writes and maintains the wiki; the human curates
sources, asks questions, and directs analysis.

## Directory Layout

```
raw/            # Immutable source documents (articles, papers, transcripts, images, data)
raw/assets/     # Downloaded images and attachments
wiki/           # LLM-generated and LLM-maintained markdown files
wiki/index.md   # Content catalog — every wiki page listed with a one-line summary
wiki/log.md     # Chronological append-only log of all operations
```

## Conventions

- **Raw sources are immutable.** Never modify files in `raw/`. They are the source of truth.
- **The LLM owns `wiki/`.** All creation, editing, and maintenance of wiki pages is done by the LLM.
- **Wikilinks.** Use `[[Page Name]]` links between wiki pages for Obsidian compatibility.
- **Frontmatter.** Every wiki page should include YAML frontmatter:
  ```yaml
  ---
  title: Page Title
  type: entity | concept | source-summary | comparison | synthesis | overview
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  sources: [list of raw source filenames]
  tags: [relevant, tags]
  ---
  ```
- **One concept per page.** Keep pages focused. Create new pages rather than overloading existing ones.
- **Cross-references.** When updating a page, check for and add links to related pages. Backlinks should be bidirectional.
- **Contradictions.** When new information contradicts existing wiki content, flag it explicitly with a `> [!warning] Contradiction` callout and explain both positions.
- **Data gaps.** Note known unknowns with `> [!question] Data Gap` callouts.

## Operations

### Ingest

When the user adds a new source to `raw/`:

1. Read the source document fully.
2. Discuss key takeaways with the user.
3. Create a **source summary** page in `wiki/` (e.g., `wiki/sources/source-name.md`).
4. Update `wiki/index.md` with the new page entry.
5. Create or update **entity pages** for people, organizations, products mentioned.
6. Create or update **concept pages** for key ideas and themes.
7. Add cross-references (`[[wikilinks]]`) across all touched pages.
8. Check for contradictions with existing wiki content and flag them.
9. Append an entry to `wiki/log.md`.

A single source may touch 10-15 wiki pages. Prefer ingesting one source at a
time with user involvement.

### Query

When the user asks a question:

1. Read `wiki/index.md` to find relevant pages (scan TLDRs).
2. Read the relevant full pages.
3. Synthesize an answer with `[[wikilink]]` citations to wiki pages.
4. If the answer is valuable, offer to file it back into the wiki as a new page.
   Queries that produce good synthesis should become wiki pages so the knowledge
   compounds.

### Lint

Periodically health-check the wiki. Look for:

- Contradictions between pages
- Stale claims superseded by newer sources
- Orphan pages with no inbound links
- Important concepts mentioned but lacking their own page
- Missing cross-references
- Data gaps that could be filled with a web search

Suggest new questions to investigate and new sources to look for.

## Page Types

| Type             | Purpose                                         | Directory            |
| ---------------- | ----------------------------------------------- | -------------------- |
| source-summary   | Summary of a single raw source                  | `wiki/sources/`      |
| entity           | Person, org, product, place                     | `wiki/entities/`     |
| concept          | Idea, framework, methodology                    | `wiki/concepts/`     |
| comparison       | Side-by-side analysis of multiple things         | `wiki/comparisons/`  |
| synthesis        | Cross-cutting analysis combining multiple sources| `wiki/syntheses/`    |
| overview         | High-level overview of the entire domain         | `wiki/`              |

## Index Format

Each entry in `wiki/index.md` should follow:

```markdown
- [[Page Name]] — One-line summary. (type, N sources)
```

Organized by category with section headers.

## Log Format

Each entry in `wiki/log.md` should follow:

```markdown
## [YYYY-MM-DD] operation | Title
Brief description of what was done and what pages were touched.
```

Operations: `ingest`, `query`, `lint`, `update`, `create`.
