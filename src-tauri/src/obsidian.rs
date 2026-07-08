//! Obsidian vault 导出:高亮/Spark 解读/笔记追加到每本书一个的专属笔记文件,
//! 整书知识图谱导出为可覆盖的生成文件。
//!
//! 安全边界:只在 vault 内写入(canonicalize 后前缀校验,拒绝 `..`/绝对子目录),
//! 片段文件只追加不覆盖用户内容,所有写入走 temp+rename 原子写。

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;

pub const DEFAULT_SUBDIR: &str = "框选精读";
const MAX_FILE_STEM_CHARS: usize = 80;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianSnippet {
    /// highlight | spark | note
    pub kind: String,
    pub page_number: Option<u32>,
    pub quote: Option<String>,
    pub content: String,
    #[serde(default)]
    pub chunk_ids: Vec<String>,
    /// 前端本地时间字符串,仅展示用
    pub timestamp: String,
}

/// 追加一条阅读片段到 `{vault}/{subdir}/{书名}.md`,返回写入路径。
pub fn export_snippet(
    vault_path: &Path,
    subdir: &str,
    book_id: &str,
    book_title: &str,
    snippet: &ObsidianSnippet,
) -> Result<PathBuf> {
    let note_dir = resolve_note_dir(vault_path, subdir)?;
    let target = note_dir.join(format!("{}.md", sanitize_file_stem(book_title)));

    let mut body = if target.exists() {
        fs::read_to_string(&target)
            .with_context(|| format!("failed to read existing note {}", target.display()))?
    } else {
        note_header(book_id, book_title, &snippet.timestamp)
    };
    body.push_str(&render_snippet(snippet));
    atomic_write(&target, &body)?;
    Ok(target)
}

/// 整书知识图谱导出到 `{vault}/{subdir}/{书名}-知识图谱.md`。
/// 该文件是纯生成物,允许整体覆盖重写。
pub fn export_generated_document(
    vault_path: &Path,
    subdir: &str,
    book_title: &str,
    suffix: &str,
    markdown: &str,
) -> Result<PathBuf> {
    let note_dir = resolve_note_dir(vault_path, subdir)?;
    let target = note_dir.join(format!("{}-{suffix}.md", sanitize_file_stem(book_title)));
    atomic_write(&target, markdown)?;
    Ok(target)
}

fn note_header(book_id: &str, book_title: &str, created: &str) -> String {
    format!(
        "---\nsource: 框选精读\nbook_id: {book_id}\ncreated: \"{created}\"\n---\n\n# {book_title} · 阅读笔记\n"
    )
}

fn render_snippet(snippet: &ObsidianSnippet) -> String {
    let mut output = String::from("\n---\n\n## ");
    output.push_str(&snippet.timestamp);
    if let Some(page) = snippet.page_number {
        output.push_str(&format!(" · 第 {page} 页"));
    }
    output.push_str(match snippet.kind.as_str() {
        "highlight" => " · 高亮",
        "spark" => " · Spark 解读",
        _ => " · 笔记",
    });
    output.push('\n');

    if let Some(quote) = snippet
        .quote
        .as_deref()
        .map(str::trim)
        .filter(|quote| !quote.is_empty())
    {
        output.push_str("\n> [!quote] 原文\n");
        for line in quote.lines() {
            output.push_str("> ");
            output.push_str(line);
            output.push('\n');
        }
    }

    let content = snippet.content.trim();
    if !content.is_empty() {
        output.push('\n');
        output.push_str(content);
        output.push('\n');
    }

    if !snippet.chunk_ids.is_empty() {
        let refs = snippet
            .chunk_ids
            .iter()
            .map(|chunk_id| format!("`{}`", chunk_id.replace('`', "")))
            .collect::<Vec<_>>()
            .join(" ");
        output.push_str(&format!("\n来源块: {refs}\n"));
    }
    output
}

fn resolve_note_dir(vault_path: &Path, subdir: &str) -> Result<PathBuf> {
    if vault_path.as_os_str().is_empty() {
        bail!("Obsidian vault 路径未配置");
    }
    let vault = vault_path
        .canonicalize()
        .with_context(|| format!("Obsidian vault 不存在: {}", vault_path.display()))?;
    if !vault.is_dir() {
        bail!("Obsidian vault 不是目录: {}", vault.display());
    }

    let mut note_dir = vault.clone();
    for component in Path::new(subdir.trim()).components() {
        match component {
            Component::Normal(segment) => note_dir.push(segment),
            Component::CurDir => {}
            _ => bail!("Obsidian 子目录不合法(不允许绝对路径或 ..): {subdir}"),
        }
    }
    fs::create_dir_all(&note_dir)
        .with_context(|| format!("failed to create note dir {}", note_dir.display()))?;
    let canonical = note_dir
        .canonicalize()
        .with_context(|| format!("failed to resolve note dir {}", note_dir.display()))?;
    if !canonical.starts_with(&vault) {
        bail!("Obsidian 子目录逃逸出 vault: {subdir}");
    }
    Ok(canonical)
}

fn sanitize_file_stem(title: &str) -> String {
    let cleaned = title
        .chars()
        .map(|ch| {
            if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_control()
            {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches(|ch: char| ch == '.' || ch.is_whitespace());
    let stem = trimmed
        .chars()
        .take(MAX_FILE_STEM_CHARS)
        .collect::<String>();
    let stem = stem
        .trim_matches(|ch: char| ch == '.' || ch.is_whitespace())
        .to_string();
    if stem.is_empty() {
        "未命名书籍".to_string()
    } else {
        stem
    }
}

fn atomic_write(target: &Path, content: &str) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("invalid target path {}", target.display()))?;
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        target
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "note.md".to_string()),
        std::process::id()
    ));
    fs::write(&temp, content)
        .with_context(|| format!("failed to write temp file {}", temp.display()))?;
    fs::rename(&temp, target).with_context(|| {
        let _ = fs::remove_file(&temp);
        format!("failed to move note into place {}", target.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "focused-reading-obsidian-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("vault dir");
        dir
    }

    fn snippet(kind: &str) -> ObsidianSnippet {
        ObsidianSnippet {
            kind: kind.to_string(),
            page_number: Some(12),
            quote: Some("第一行\n第二行".to_string()),
            content: "这是解读内容。".to_string(),
            chunk_ids: vec!["B012-C3".to_string(), "B013-C1".to_string()],
            timestamp: "2026-07-07 21:30".to_string(),
        }
    }

    #[test]
    fn snippet_export_creates_file_with_frontmatter_and_callout() {
        let vault = temp_vault("create");
        let path = export_snippet(
            &vault,
            DEFAULT_SUBDIR,
            "book-1",
            "深度学习",
            &snippet("spark"),
        )
        .expect("export should succeed");

        assert_eq!(
            path,
            vault.canonicalize().unwrap().join("框选精读/深度学习.md")
        );
        let body = fs::read_to_string(&path).expect("note should exist");
        assert!(body.starts_with("---\nsource: 框选精读\nbook_id: book-1\n"));
        assert!(body.contains("# 深度学习 · 阅读笔记"));
        assert!(body.contains("## 2026-07-07 21:30 · 第 12 页 · Spark 解读"));
        assert!(body.contains("> [!quote] 原文\n> 第一行\n> 第二行"));
        assert!(body.contains("来源块: `B012-C3` `B013-C1`"));

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn snippet_export_appends_and_preserves_user_edits() {
        let vault = temp_vault("append");
        let path = export_snippet(
            &vault,
            DEFAULT_SUBDIR,
            "book-1",
            "深度学习",
            &snippet("highlight"),
        )
        .expect("first export");
        let user_edit = "\n用户手写的一段话,不能丢。\n";
        fs::write(&path, fs::read_to_string(&path).unwrap() + user_edit)
            .expect("simulate user edit");

        export_snippet(
            &vault,
            DEFAULT_SUBDIR,
            "book-1",
            "深度学习",
            &snippet("note"),
        )
        .expect("second export");

        let body = fs::read_to_string(&path).expect("note should exist");
        assert!(body.contains("用户手写的一段话,不能丢。"));
        assert!(body.contains("· 高亮"));
        assert!(body.contains("· 笔记"));
        assert_eq!(
            body.matches("---\nsource: 框选精读").count(),
            1,
            "frontmatter 只出现一次"
        );

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn subdir_escape_and_missing_vault_are_rejected() {
        let vault = temp_vault("escape");
        let escape = export_snippet(&vault, "../outside", "book-1", "书", &snippet("note"));
        assert!(escape.is_err(), "`..` 子目录必须被拒绝");
        let absolute = export_snippet(&vault, "/etc", "book-1", "书", &snippet("note"));
        assert!(absolute.is_err(), "绝对路径子目录必须被拒绝");

        let missing = vault.join("does-not-exist");
        let result = export_snippet(&missing, DEFAULT_SUBDIR, "book-1", "书", &snippet("note"));
        assert!(result.is_err(), "vault 不存在必须报错");

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn file_stem_is_sanitized() {
        assert_eq!(
            sanitize_file_stem("a/b\\c:d*e?f\"g<h>i|j"),
            "a b c d e f g h i j"
        );
        assert_eq!(sanitize_file_stem("  .hidden.  "), "hidden");
        assert_eq!(sanitize_file_stem(""), "未命名书籍");
        assert_eq!(sanitize_file_stem("中文 标题"), "中文 标题");
    }

    #[test]
    fn generated_document_overwrites_previous_version() {
        let vault = temp_vault("generated");
        let first = export_generated_document(&vault, DEFAULT_SUBDIR, "深度学习", "知识图谱", "v1")
            .expect("first export");
        let second =
            export_generated_document(&vault, DEFAULT_SUBDIR, "深度学习", "知识图谱", "v2")
                .expect("second export");
        assert_eq!(first, second);
        assert_eq!(fs::read_to_string(&second).unwrap(), "v2");

        let _ = fs::remove_dir_all(&vault);
    }
}
