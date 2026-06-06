use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use zip::ZipArchive;

use crate::{
    coordinates::COORDINATE_VERSION,
    storage::{ParsedChunkInput, ParsedPageInput, TextQuality},
};

const TARGET_PAGE_CHARS: usize = 3500;
const MAX_PAGE_CHARS: usize = 5200;
const TARGET_CHUNK_CHARS: usize = 900;
const MAX_CHUNK_CHARS: usize = 1400;

#[derive(Debug)]
pub struct PlainBookParsedDocument {
    pub title: String,
    pub engine: String,
    pub coordinate_mode: String,
    pub quality: TextQuality,
    pub pages: Vec<ParsedPageInput>,
    pub chunks: Vec<ParsedChunkInput>,
}

#[derive(Debug)]
struct Section {
    title: Option<String>,
    text: String,
    markdown: String,
}

#[derive(Debug, Default, Deserialize)]
struct XmlContainer {
    #[serde(rename = "rootfiles", default)]
    rootfiles: XmlRootfiles,
}

#[derive(Debug, Default, Deserialize)]
struct XmlRootfiles {
    #[serde(rename = "rootfile", default)]
    rootfile: Vec<XmlRootfile>,
}

#[derive(Debug, Default, Deserialize)]
struct XmlRootfile {
    #[serde(rename = "@full-path", default)]
    full_path: String,
}

#[derive(Debug, Default, Deserialize)]
struct OpfPackage {
    #[serde(rename = "metadata", default)]
    metadata: OpfMetadata,
    #[serde(rename = "manifest", default)]
    manifest: OpfManifest,
    #[serde(rename = "spine", default)]
    spine: OpfSpine,
}

#[derive(Debug, Default, Deserialize)]
struct OpfMetadata {
    #[serde(rename = "title", default)]
    title: Vec<String>,
    #[serde(rename = "creator", default)]
    creator: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct OpfManifest {
    #[serde(rename = "item", default)]
    items: Vec<OpfManifestItem>,
}

#[derive(Debug, Default, Deserialize)]
struct OpfManifestItem {
    #[serde(rename = "@id", default)]
    id: String,
    #[serde(rename = "@href", default)]
    href: String,
    #[serde(rename = "@media-type", default)]
    media_type: String,
}

#[derive(Debug, Default, Deserialize)]
struct OpfSpine {
    #[serde(rename = "itemref", default)]
    itemrefs: Vec<OpfItemref>,
}

#[derive(Debug, Default, Deserialize)]
struct OpfItemref {
    #[serde(rename = "@idref", default)]
    idref: String,
}

pub fn parse_plain_book(path: &Path, title: Option<String>) -> Result<PlainBookParsedDocument> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "txt" | "text" => parse_txt(path, title),
        "epub" => parse_epub(path, title),
        _ => Err(anyhow!(
            "unsupported text book format: {}",
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("unknown")
        )),
    }
}

pub fn supported_plain_book_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "txt" | "text" | "epub"
            )
        })
        .unwrap_or(false)
}

fn parse_txt(path: &Path, title: Option<String>) -> Result<PlainBookParsedDocument> {
    let bytes =
        fs::read(path).with_context(|| format!("failed to read TXT file {}", path.display()))?;
    let text = decode_text_bytes(&bytes);
    let text = normalize_text(&text);
    if text.trim().is_empty() {
        return Err(anyhow!("TXT 文件没有可导入的正文"));
    }
    let title = clean_title(title).unwrap_or_else(|| file_stem_title(path, "TXT 书籍"));
    let sections = text
        .split("\n\n")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| Section {
            title: section_title_candidate(part),
            text: part.to_string(),
            markdown: part.to_string(),
        })
        .collect::<Vec<_>>();
    document_from_sections(title, "text-import-txt", sections)
}

fn parse_epub(path: &Path, title: Option<String>) -> Result<PlainBookParsedDocument> {
    let bytes =
        fs::read(path).with_context(|| format!("failed to read EPUB file {}", path.display()))?;
    let mut archive = ZipArchive::new(Cursor::new(bytes)).context("failed to open EPUB archive")?;
    let container_xml = read_zip_string(&mut archive, "META-INF/container.xml")
        .context("failed to read EPUB container.xml")?;
    let container: XmlContainer =
        quick_xml::de::from_str(&container_xml).context("failed to parse EPUB container.xml")?;
    let opf_path = container
        .rootfiles
        .rootfile
        .iter()
        .find_map(|rootfile| {
            let value = rootfile.full_path.trim();
            (!value.is_empty()).then(|| normalize_zip_path(value))
        })
        .ok_or_else(|| anyhow!("EPUB 缺少 OPF rootfile"))?;
    let opf_xml = read_zip_string(&mut archive, &opf_path)
        .with_context(|| format!("failed to read EPUB OPF {opf_path}"))?;
    let opf: OpfPackage =
        quick_xml::de::from_str(&opf_xml).context("failed to parse EPUB OPF package")?;
    let opf_dir = parent_zip_dir(&opf_path);
    let manifest = opf
        .manifest
        .items
        .iter()
        .filter(|item| !item.id.trim().is_empty() && !item.href.trim().is_empty())
        .map(|item| (item.id.clone(), item))
        .collect::<HashMap<_, _>>();
    let mut seen_paths = HashSet::new();
    let mut sections = Vec::new();
    for itemref in &opf.spine.itemrefs {
        let Some(item) = manifest.get(itemref.idref.as_str()) else {
            continue;
        };
        if !is_epub_document_item(item) {
            continue;
        }
        let zip_path = join_zip_path(&opf_dir, &item.href);
        if !seen_paths.insert(zip_path.clone()) {
            continue;
        }
        let Ok(html) = read_zip_string(&mut archive, &zip_path) else {
            continue;
        };
        let markdown = html_to_markdown(&html);
        let text = markdown_to_text(&markdown);
        if text.trim().is_empty() {
            continue;
        }
        sections.push(Section {
            title: first_markdown_heading(&markdown),
            text,
            markdown,
        });
    }
    if sections.is_empty() {
        return Err(anyhow!("EPUB 没有可导入的正文 spine 文档"));
    }
    let title = clean_title(title)
        .or_else(|| epub_metadata_title(&opf.metadata))
        .unwrap_or_else(|| file_stem_title(path, "EPUB 书籍"));
    document_from_sections(title, "text-import-epub", sections)
}

fn document_from_sections(
    title: String,
    engine: &str,
    sections: Vec<Section>,
) -> Result<PlainBookParsedDocument> {
    let mut pages = Vec::new();
    let mut chunks = Vec::new();
    let mut page_sections = Vec::new();
    let mut page_chars = 0_usize;

    for section in sections {
        for piece in split_large_section(section) {
            let piece_chars = piece.text.chars().count().max(piece.markdown.chars().count());
            if !page_sections.is_empty()
                && page_chars + piece_chars > TARGET_PAGE_CHARS
                && page_chars >= TARGET_PAGE_CHARS / 2
            {
                flush_page(&mut pages, &mut chunks, &mut page_sections);
                page_chars = 0;
            }
            page_chars += piece_chars;
            page_sections.push(piece);
            if page_chars >= MAX_PAGE_CHARS {
                flush_page(&mut pages, &mut chunks, &mut page_sections);
                page_chars = 0;
            }
        }
    }
    flush_page(&mut pages, &mut chunks, &mut page_sections);

    if pages.is_empty() {
        return Err(anyhow!("文本书没有可导入的正文"));
    }

    let full_text = pages
        .iter()
        .map(|page| page.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(PlainBookParsedDocument {
        title,
        engine: engine.to_string(),
        coordinate_mode: "text-only".to_string(),
        quality: text_quality(&full_text),
        pages,
        chunks,
    })
}

fn flush_page(
    pages: &mut Vec<ParsedPageInput>,
    chunks: &mut Vec<ParsedChunkInput>,
    page_sections: &mut Vec<Section>,
) {
    if page_sections.is_empty() {
        return;
    }
    let page_index = pages.len() as u32;
    let page_text = page_sections
        .iter()
        .map(|section| section.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let page_markdown = page_sections
        .iter()
        .map(|section| section.markdown.trim())
        .filter(|markdown| !markdown.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if page_text.trim().is_empty() && page_markdown.trim().is_empty() {
        page_sections.clear();
        return;
    }
    pages.push(ParsedPageInput {
        page_index,
        text: page_text,
        markdown: if page_markdown.trim().is_empty() {
            page_to_markdown(page_index + 1, &markdown_to_text(&page_markdown))
        } else {
            page_markdown
        },
    });
    for (chunk_index, section) in page_sections.iter().enumerate() {
        let chunk_text = section.text.trim();
        if chunk_text.is_empty() {
            continue;
        }
        let chunk_id = format!("p{}-c{}", page_index + 1, chunk_index + 1);
        chunks.push(ParsedChunkInput {
            chunk_id: chunk_id.clone(),
            page_index,
            text: chunk_text.to_string(),
            markdown: format!(
                "### [{chunk_id}] Page {}\n\n{}",
                page_index + 1,
                section.markdown.trim()
            ),
            rects: Vec::new(),
            coordinate_version: COORDINATE_VERSION,
        });
    }
    page_sections.clear();
}

fn split_large_section(section: Section) -> Vec<Section> {
    let text_len = section.text.chars().count();
    if text_len <= MAX_CHUNK_CHARS {
        return vec![section];
    }
    let paragraphs = section
        .text
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let mut pieces = Vec::new();
    let mut buffer = String::new();
    for paragraph in paragraphs {
        if !buffer.is_empty()
            && buffer.chars().count() + paragraph.chars().count() > TARGET_CHUNK_CHARS
        {
            pieces.extend(split_text_piece(&buffer, section.title.as_deref()));
            buffer.clear();
        }
        if !buffer.is_empty() {
            buffer.push('\n');
        }
        buffer.push_str(paragraph);
    }
    if !buffer.trim().is_empty() {
        pieces.extend(split_text_piece(&buffer, section.title.as_deref()));
    }
    if pieces.is_empty() {
        split_text_piece(&section.text, section.title.as_deref())
    } else {
        pieces
    }
}

fn split_text_piece(text: &str, title: Option<&str>) -> Vec<Section> {
    let mut pieces = Vec::new();
    let chars = text.chars().collect::<Vec<_>>();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + TARGET_CHUNK_CHARS).min(chars.len());
        if end < chars.len() {
            let search_start = start + TARGET_CHUNK_CHARS.saturating_sub(240);
            if let Some(relative) = chars[search_start..end]
                .iter()
                .rposition(|ch| matches!(ch, '。' | '！' | '？' | '.' | '!' | '?' | ';' | '；'))
            {
                end = search_start + relative + 1;
            }
        }
        let piece = chars[start..end].iter().collect::<String>();
        let text = normalize_text(&piece);
        if !text.is_empty() {
            let markdown = title
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("## {}\n\n{}", value.trim(), text))
                .unwrap_or_else(|| text.clone());
            pieces.push(Section {
                title: title.map(str::to_string),
                text,
                markdown,
            });
        }
        start = end;
    }
    pieces
}

fn decode_text_bytes(bytes: &[u8]) -> String {
    if let Some(bytes) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    if let Some(bytes) = bytes.strip_prefix(&[0xfe, 0xff]) {
        return decode_utf16be(bytes);
    }
    if let Some(bytes) = bytes.strip_prefix(&[0xff, 0xfe]) {
        return decode_utf16le(bytes);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn decode_utf16le(bytes: &[u8]) -> String {
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&units)
}

fn decode_utf16be(bytes: &[u8]) -> String {
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&units)
}

fn read_zip_string(archive: &mut ZipArchive<Cursor<Vec<u8>>>, path: &str) -> Result<String> {
    let mut file = archive
        .by_name(path)
        .with_context(|| format!("missing EPUB entry {path}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .with_context(|| format!("failed to read EPUB entry {path}"))?;
    Ok(decode_text_bytes(&bytes))
}

fn is_epub_document_item(item: &OpfManifestItem) -> bool {
    let media_type = item.media_type.to_ascii_lowercase();
    media_type.contains("xhtml")
        || media_type.contains("html")
        || item.href.ends_with(".xhtml")
        || item.href.ends_with(".html")
        || item.href.ends_with(".htm")
}

fn epub_metadata_title(metadata: &OpfMetadata) -> Option<String> {
    let title = metadata
        .title
        .iter()
        .find_map(|value| clean_title(Some(value.clone())))?;
    let creator = metadata
        .creator
        .iter()
        .find_map(|value| clean_title(Some(value.clone())));
    Some(match creator {
        Some(creator) => format!("{title} - {creator}"),
        None => title,
    })
}

fn html_to_markdown(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut cursor = 0;
    let mut skip_until: Option<String> = None;
    while cursor < html.len() {
        if let Some(end_tag) = skip_until.as_deref() {
            if html[cursor..].to_ascii_lowercase().starts_with(end_tag) {
                if let Some(end) = html[cursor..].find('>') {
                    cursor += end + 1;
                    skip_until = None;
                    continue;
                }
            }
            cursor += html[cursor..].chars().next().map(char::len_utf8).unwrap_or(1);
            continue;
        }

        if html.as_bytes().get(cursor) == Some(&b'<') {
            if html[cursor..].starts_with("<!--") {
                if let Some(end) = html[cursor + 4..].find("-->") {
                    cursor += 4 + end + 3;
                } else {
                    break;
                }
                continue;
            }
            let Some(tag_end_relative) = html[cursor..].find('>') else {
                output.push_str(&html[cursor..]);
                break;
            };
            let tag = &html[cursor..cursor + tag_end_relative + 1];
            let tag_name = html_tag_name(tag);
            let closing = tag.trim_start().starts_with("</");
            let replacement = html_tag_replacement(tag, &tag_name, closing);
            if matches!(tag_name.as_str(), "script" | "style" | "svg") && !closing {
                skip_until = Some(format!("</{tag_name}"));
            }
            output.push_str(&replacement);
            cursor += tag_end_relative + 1;
            continue;
        }

        let ch = html[cursor..].chars().next().expect("cursor inside string");
        output.push(ch);
        cursor += ch.len_utf8();
    }
    normalize_markdown(&decode_basic_html_entities(&output))
}

fn html_tag_name(tag: &str) -> String {
    tag.trim_start_matches('<')
        .trim_start_matches('/')
        .trim_start()
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | ':'))
        .collect::<String>()
        .to_ascii_lowercase()
}

fn html_tag_replacement(tag: &str, tag_name: &str, closing: bool) -> String {
    match (tag_name, closing) {
        ("h1", false) => "\n\n# ".to_string(),
        ("h2", false) => "\n\n## ".to_string(),
        ("h3", false) => "\n\n### ".to_string(),
        ("h4", false) => "\n\n#### ".to_string(),
        ("h5", false) => "\n\n##### ".to_string(),
        ("h6", false) => "\n\n###### ".to_string(),
        ("h1" | "h2" | "h3" | "h4" | "h5" | "h6", true) => "\n\n".to_string(),
        ("p" | "div" | "section" | "article" | "header" | "footer", false) => {
            "\n\n".to_string()
        }
        ("p" | "div" | "section" | "article" | "header" | "footer", true) => {
            "\n\n".to_string()
        }
        ("br", _) => "\n".to_string(),
        ("li", false) => "\n- ".to_string(),
        ("li", true) => "\n".to_string(),
        ("blockquote", false) => "\n\n> ".to_string(),
        ("blockquote", true) => "\n\n".to_string(),
        ("pre", false) => "\n\n```text\n".to_string(),
        ("pre", true) => "\n```\n\n".to_string(),
        ("code", false) => "`".to_string(),
        ("code", true) => "`".to_string(),
        ("img", false) => image_alt_text(tag),
        ("title", false) => "\n\n# ".to_string(),
        ("title", true) => "\n\n".to_string(),
        _ => " ".to_string(),
    }
}

fn image_alt_text(tag: &str) -> String {
    html_attr(tag, "alt")
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" [image: {}] ", value.trim()))
        .unwrap_or_else(|| " [image] ".to_string())
}

fn html_attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut search_start = 0;
    while let Some(relative) = lower[search_start..].find(name) {
        let start = search_start + relative;
        let before = lower[..start].chars().next_back();
        if before.is_some_and(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':')) {
            search_start = start + name.len();
            continue;
        }
        let mut cursor = start + name.len();
        cursor = skip_ascii_whitespace(tag, cursor);
        if tag.as_bytes().get(cursor) != Some(&b'=') {
            search_start = start + name.len();
            continue;
        }
        cursor += 1;
        cursor = skip_ascii_whitespace(tag, cursor);
        let quote = *tag.as_bytes().get(cursor)?;
        if quote == b'"' || quote == b'\'' {
            let value_start = cursor + 1;
            let value_end = tag[value_start..].find(quote as char)? + value_start;
            return Some(decode_basic_html_entities(&tag[value_start..value_end]));
        }
        let value_start = cursor;
        let value_end = tag[value_start..]
            .find(|ch: char| ch.is_ascii_whitespace() || ch == '>')
            .map(|offset| value_start + offset)
            .unwrap_or(tag.len());
        return Some(decode_basic_html_entities(&tag[value_start..value_end]));
    }
    None
}

fn skip_ascii_whitespace(value: &str, mut cursor: usize) -> usize {
    while value
        .as_bytes()
        .get(cursor)
        .is_some_and(|byte| byte.is_ascii_whitespace())
    {
        cursor += 1;
    }
    cursor
}

fn normalize_markdown(value: &str) -> String {
    let mut output = String::new();
    for raw_line in value.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = raw_line.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            if !output.ends_with("\n\n") {
                output.push_str("\n\n");
            }
            continue;
        }
        if !output.is_empty() && !output.ends_with('\n') {
            output.push(' ');
        }
        output.push_str(&line);
        output.push('\n');
    }
    normalize_text(&output)
}

fn markdown_to_text(markdown: &str) -> String {
    let mut text = String::with_capacity(markdown.len());
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            continue;
        }
        let line = trimmed
            .trim_start_matches('#')
            .trim_start_matches('>')
            .trim_start_matches("- ")
            .trim_matches('`')
            .trim();
        if !line.is_empty() {
            text.push_str(line);
            text.push('\n');
        }
    }
    normalize_text(&text)
}

fn first_markdown_heading(markdown: &str) -> Option<String> {
    markdown.lines().find_map(|line| {
        let trimmed = line.trim();
        let without_marks = trimmed.trim_start_matches('#').trim();
        (trimmed.starts_with('#') && !without_marks.is_empty()).then(|| without_marks.to_string())
    })
}

fn section_title_candidate(text: &str) -> Option<String> {
    let first_line = text.lines().next()?.trim();
    let chars = first_line.chars().count();
    if (2..=80).contains(&chars)
        && !first_line.ends_with('。')
        && !first_line.ends_with('.')
        && text.lines().count() <= 3
    {
        Some(first_line.to_string())
    } else {
        None
    }
}

fn page_to_markdown(page_number: u32, text: &str) -> String {
    format!("## Page {page_number}\n\n{}", text.trim())
}

fn normalize_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for ch in value.replace("\r\n", "\n").replace('\r', "\n").chars() {
        if ch == '\t' {
            output.push(' ');
        } else if ch.is_control() && ch != '\n' {
            output.push(' ');
        } else {
            output.push(ch);
        }
    }
    while output.contains("  ") {
        output = output.replace("  ", " ");
    }
    while output.contains(" \n") {
        output = output.replace(" \n", "\n");
    }
    while output.contains("\n ") {
        output = output.replace("\n ", "\n");
    }
    while output.contains("\n\n\n") {
        output = output.replace("\n\n\n", "\n\n");
    }
    output.trim().to_string()
}

fn decode_basic_html_entities(value: &str) -> String {
    let mut output = value
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'");
    output = decode_numeric_entities(&output);
    output
}

fn decode_numeric_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    while let Some(relative) = value[cursor..].find("&#") {
        let start = cursor + relative;
        output.push_str(&value[cursor..start]);
        let Some(end_relative) = value[start..].find(';') else {
            output.push_str(&value[start..]);
            return output;
        };
        let end = start + end_relative;
        let raw = &value[start + 2..end];
        let decoded = if let Some(hex) = raw.strip_prefix(['x', 'X']) {
            u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
        } else {
            raw.parse::<u32>().ok().and_then(char::from_u32)
        };
        if let Some(ch) = decoded {
            output.push(ch);
        } else {
            output.push_str(&value[start..=end]);
        }
        cursor = end + 1;
    }
    output.push_str(&value[cursor..]);
    output
}

fn clean_title(value: Option<String>) -> Option<String> {
    value
        .map(|value| normalize_text(&decode_basic_html_entities(&value)))
        .filter(|value| !value.trim().is_empty())
}

fn file_stem_title(path: &Path, fallback: &str) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

fn normalize_zip_path(value: &str) -> String {
    value.replace('\\', "/").trim_start_matches('/').to_string()
}

fn parent_zip_dir(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(|value| value.to_str())
        .map(|value| value.replace('\\', "/"))
        .unwrap_or_default()
}

fn join_zip_path(base: &str, href: &str) -> String {
    let href = normalize_zip_path(&decode_percent_path(href));
    let joined = if base.trim().is_empty() {
        PathBuf::from(href)
    } else {
        Path::new(base).join(href)
    };
    let mut parts = Vec::new();
    for component in joined.components() {
        match component {
            std::path::Component::Normal(value) => parts.push(value.to_string_lossy().to_string()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                parts.pop();
            }
            _ => {}
        }
    }
    parts.join("/")
}

fn decode_percent_path(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    output.push(byte as char);
                    index += 3;
                    continue;
                }
            }
        }
        output.push(bytes[index] as char);
        index += 1;
    }
    output
}

fn text_quality(text: &str) -> TextQuality {
    let chars = text
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<Vec<_>>();
    if chars.is_empty() {
        return TextQuality {
            char_count: 0,
            replacement_char_ratio: 1.0,
            control_char_ratio: 1.0,
            looks_usable: false,
        };
    }
    let replacement_count = chars.iter().filter(|ch| **ch == '\u{fffd}').count();
    let control_count = chars.iter().filter(|ch| ch.is_control()).count();
    TextQuality {
        char_count: chars.len() as u32,
        replacement_char_ratio: replacement_count as f64 / chars.len() as f64,
        control_char_ratio: control_count as f64 / chars.len() as f64,
        looks_usable: chars.len() > 40
            && replacement_count as f64 / chars.len() as f64 <= 0.03
            && control_count as f64 / chars.len() as f64 <= 0.01,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parses_txt_into_text_only_pages_and_chunks() {
        let path = std::env::temp_dir().join(format!(
            "spark-text-import-{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::write(&path, "第一章\n\n这是第一段正文。\n\n这是第二段正文。")
            .expect("fixture should write");

        let parsed = parse_plain_book(&path, None).expect("txt should parse");

        assert_eq!(parsed.engine, "text-import-txt");
        assert_eq!(parsed.coordinate_mode, "text-only");
        assert_eq!(parsed.title, path.file_stem().unwrap().to_string_lossy());
        assert_eq!(parsed.pages.len(), 1);
        assert!(parsed.pages[0].text.contains("这是第一段正文"));
        assert!(parsed.chunks.len() >= 2);
        assert!(parsed.chunks.iter().all(|chunk| chunk.rects.is_empty()));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn converts_basic_html_to_markdown() {
        let markdown = html_to_markdown(
            "<html><body><h1>第一章</h1><p>正文 &amp; 注释</p><ul><li>条目</li></ul></body></html>",
        );

        assert!(markdown.contains("# 第一章"));
        assert!(markdown.contains("正文 & 注释"));
        assert!(markdown.contains("- 条目"));
        assert_eq!(markdown_to_text(&markdown), "第一章\n正文 & 注释\n条目");
    }

    #[test]
    fn parses_minimal_epub_spine() {
        let path = std::env::temp_dir().join(format!(
            "spark-text-import-{}.epub",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        {
            let file = fs::File::create(&path).expect("epub should create");
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::default();
            zip.start_file("META-INF/container.xml", options)
                .expect("container start");
            zip.write_all(
                br#"<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/content.opf"/>
  </rootfiles>
</container>"#,
            )
            .expect("container write");
            zip.start_file("OPS/content.opf", options)
                .expect("opf start");
            zip.write_all(
                r#"<package>
  <metadata><title>测试 EPUB</title><creator>作者</creator></metadata>
  <manifest><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter1"/></spine>
</package>"#
                    .as_bytes(),
            )
            .expect("opf write");
            zip.start_file("OPS/chapter1.xhtml", options)
                .expect("chapter start");
            zip.write_all(
                r#"<html><body><h1>第一章</h1><p>这是 EPUB 正文。</p></body></html>"#
                    .as_bytes(),
            )
            .expect("chapter write");
            zip.finish().expect("zip finish");
        }

        let parsed = parse_plain_book(&path, None).expect("epub should parse");

        assert_eq!(parsed.engine, "text-import-epub");
        assert_eq!(parsed.title, "测试 EPUB - 作者");
        assert_eq!(parsed.pages.len(), 1);
        assert!(parsed.pages[0].markdown.contains("# 第一章"));
        assert!(parsed.chunks[0].text.contains("这是 EPUB 正文"));
        let _ = fs::remove_file(path);
    }
}
