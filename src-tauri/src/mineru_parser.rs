use std::{
    cmp::Ordering,
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::{
    coordinates::{
        mineru_bbox_to_normalized, top_left_points_to_normalized_with_rotation, PageSize,
        COORDINATE_VERSION,
    },
    storage::{NormalizedRectInput, ParsedChunkInput, ParsedPageInput, TextQuality},
};

const PRECISE_COORDINATE_MODE: &str = "normalized-page-rects";
const APPROXIMATE_ANGLE_COORDINATE_MODE: &str = "normalized-page-rects-approx-angle";
const ANGLE_EPSILON: f64 = 1e-6;

#[derive(Debug)]
pub struct MinerUParsedDocument {
    pub engine: String,
    pub coordinate_mode: String,
    pub quality: TextQuality,
    pub pages: Vec<ParsedPageInput>,
    pub chunks: Vec<ParsedChunkInput>,
}

#[derive(Debug, Deserialize)]
struct MinerULayout {
    pdf_info: Vec<MinerUPage>,
}

#[derive(Debug, Deserialize)]
struct MinerUPage {
    page_idx: u32,
    page_size: [f64; 2],
    #[serde(default)]
    para_blocks: Vec<MinerUBlock>,
    #[serde(default)]
    preproc_blocks: Vec<MinerUBlock>,
}

#[derive(Debug, Deserialize)]
struct MinerUBlock {
    bbox: [f64; 4],
    #[serde(default)]
    angle: Option<f64>,
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    lines: Vec<MinerULine>,
}

#[derive(Debug, Deserialize)]
struct MinerULine {
    #[serde(default)]
    spans: Vec<MinerUSpan>,
}

#[derive(Debug, Deserialize)]
struct MinerUSpan {
    #[serde(default)]
    content: String,
    #[serde(rename = "type", default)]
    span_type: String,
}

#[derive(Debug, Deserialize)]
struct MinerUContentItem {
    #[serde(rename = "type")]
    item_type: String,
    #[serde(default)]
    page_idx: Option<u32>,
    #[serde(default)]
    text: String,
    #[serde(default)]
    text_level: Option<u8>,
    #[serde(default)]
    list_items: Vec<String>,
    #[serde(default)]
    img_path: String,
    #[serde(default)]
    image_caption: Vec<String>,
    #[serde(default)]
    image_footnote: Vec<String>,
    #[serde(default)]
    table_caption: Vec<String>,
    #[serde(default)]
    table_footnote: Vec<String>,
    #[serde(default)]
    table_body: String,
    #[serde(default)]
    chart_caption: Vec<String>,
    #[serde(default)]
    chart_footnote: Vec<String>,
    #[serde(default)]
    content: String,
    #[serde(default)]
    sub_type: Option<String>,
}

#[derive(Debug)]
struct ContentPageItem {
    page_index: u32,
    text: String,
    markdown: String,
}

pub fn parse_mineru_output_dir(output_dir: &Path) -> Result<MinerUParsedDocument> {
    let layout_path = output_dir.join("layout.json");
    let markdown_path = output_dir.join("full.md");
    parse_mineru_result(&layout_path, &markdown_path)
}

pub fn merge_mineru_documents(
    mut documents: Vec<MinerUParsedDocument>,
) -> Result<MinerUParsedDocument> {
    if documents.is_empty() {
        return Err(anyhow!("no MinerU documents to merge"));
    }
    if documents.len() == 1 {
        return documents
            .pop()
            .ok_or_else(|| anyhow!("no MinerU documents to merge"));
    }

    let engine = merged_engine(&documents);
    let coordinate_mode = merged_coordinate_mode(&documents);
    let mut pages = Vec::new();
    let mut chunks = Vec::new();
    for document in documents {
        pages.extend(document.pages);
        chunks.extend(document.chunks);
    }
    pages.sort_by_key(|page| page.page_index);
    pages.dedup_by_key(|page| page.page_index);
    chunks.sort_by(|left, right| {
        left.page_index
            .cmp(&right.page_index)
            .then(left.chunk_id.cmp(&right.chunk_id))
    });
    let text = pages
        .iter()
        .map(|page| page.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(MinerUParsedDocument {
        engine,
        coordinate_mode,
        quality: text_quality(&text),
        pages,
        chunks,
    })
}

pub fn remap_relative_batch_pages(
    mut document: MinerUParsedDocument,
    page_range: Option<&str>,
) -> MinerUParsedDocument {
    let Some((start_page, _end_page)) = page_range.and_then(parse_page_range_bounds) else {
        return document;
    };
    if start_page <= 1 {
        return document;
    }
    let Some(min_page_index) = document.pages.iter().map(|page| page.page_index).min() else {
        return document;
    };
    if min_page_index > 1 {
        return document;
    }

    let offset = start_page as u32 - 1;
    for page in &mut document.pages {
        page.page_index += offset;
    }
    for chunk in &mut document.chunks {
        chunk.page_index += offset;
        chunk.chunk_id = remap_chunk_id(&chunk.chunk_id, offset);
        chunk.markdown = remap_chunk_markdown(&chunk.markdown, offset);
        for rect in &mut chunk.rects {
            rect.page_index += offset;
        }
    }
    document
}

pub fn prefix_relative_markdown_asset_paths(
    mut document: MinerUParsedDocument,
    prefix: &str,
) -> MinerUParsedDocument {
    let prefix = prefix.trim().trim_matches('/');
    if prefix.is_empty() {
        return document;
    }
    for page in &mut document.pages {
        page.markdown = prefix_markdown_links(&page.markdown, prefix);
    }
    for chunk in &mut document.chunks {
        chunk.markdown = prefix_markdown_links(&chunk.markdown, prefix);
    }
    document
}

fn prefix_markdown_links(markdown: &str, prefix: &str) -> String {
    let markdown = prefix_html_image_src_paths(markdown, prefix);
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    while let Some(relative_start) = markdown[cursor..].find("](") {
        let start = cursor + relative_start;
        output.push_str(&markdown[cursor..start + 2]);
        let path_start = start + 2;
        let Some(relative_end) = markdown[path_start..].find(')') else {
            output.push_str(&markdown[path_start..]);
            return output;
        };
        let path_end = path_start + relative_end;
        let raw_path = &markdown[path_start..path_end];
        output.push_str(&prefix_markdown_link_path(raw_path, prefix));
        output.push(')');
        cursor = path_end + 1;
    }
    output.push_str(&markdown[cursor..]);
    output
}

fn prefix_html_image_src_paths(markdown: &str, prefix: &str) -> String {
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    while let Some(tag_start_relative) = find_ascii_case_insensitive(&markdown[cursor..], "<img") {
        let tag_start = cursor + tag_start_relative;
        output.push_str(&markdown[cursor..tag_start]);
        let Some(tag_end_relative) = markdown[tag_start..].find('>') else {
            output.push_str(&markdown[tag_start..]);
            return output;
        };
        let tag_end = tag_start + tag_end_relative + 1;
        output.push_str(&prefix_html_image_tag_src(
            &markdown[tag_start..tag_end],
            prefix,
        ));
        cursor = tag_end;
    }
    output.push_str(&markdown[cursor..]);
    output
}

fn prefix_html_image_tag_src(tag: &str, prefix: &str) -> String {
    let Some((value_start, value_end)) = find_html_src_attribute(tag) else {
        return tag.to_string();
    };
    let raw_path = &tag[value_start..value_end];
    let prefixed = prefix_markdown_link_path(raw_path, prefix);
    if prefixed == raw_path {
        return tag.to_string();
    }
    format!("{}{}{}", &tag[..value_start], prefixed, &tag[value_end..])
}

fn prefix_markdown_link_path(raw_path: &str, prefix: &str) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("file:")
    {
        return raw_path.to_string();
    }
    let path_without_title = markdown_link_path_without_title(trimmed);
    let Some(relative_path) = safe_relative_markdown_path(path_without_title) else {
        return raw_path.to_string();
    };
    format!(
        "{}/{}",
        prefix,
        relative_path.to_string_lossy().replace('\\', "/")
    )
}

fn safe_relative_markdown_path(value: &str) -> Option<PathBuf> {
    let decoded = value.replace("%20", " ");
    let path = Path::new(&decoded);
    if path.is_absolute() {
        return None;
    }
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => output.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if output.as_os_str().is_empty() {
        None
    } else {
        Some(output)
    }
}

fn markdown_link_path_without_title(value: &str) -> &str {
    let trimmed = value.trim();
    if let Some(stripped) = trimmed.strip_prefix('<') {
        if let Some(end) = stripped.find('>') {
            return &stripped[..end];
        }
    }
    if let Some((path, _title)) = trimmed.split_once(" \"") {
        return path.trim_end();
    }
    if let Some((path, _title)) = trimmed.split_once(" '") {
        return path.trim_end();
    }
    trimmed
}

fn find_html_src_attribute(tag: &str) -> Option<(usize, usize)> {
    let mut search_start = 0;
    while let Some(src_relative) = find_ascii_case_insensitive(&tag[search_start..], "src") {
        let src_start = search_start + src_relative;
        let before = tag[..src_start].chars().next_back();
        if before.is_some_and(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_')) {
            search_start = src_start + 3;
            continue;
        }
        let mut cursor = src_start + 3;
        cursor = skip_ascii_whitespace(tag, cursor);
        if tag.as_bytes().get(cursor) != Some(&b'=') {
            search_start = src_start + 3;
            continue;
        }
        cursor += 1;
        cursor = skip_ascii_whitespace(tag, cursor);
        let quote = *tag.as_bytes().get(cursor)?;
        if quote == b'"' || quote == b'\'' {
            let value_start = cursor + 1;
            let value_end = tag[value_start..].find(quote as char)? + value_start;
            return Some((value_start, value_end));
        }
        let value_start = cursor;
        let value_end = tag[value_start..]
            .find(|ch: char| ch.is_ascii_whitespace() || ch == '>')
            .map(|offset| value_start + offset)
            .unwrap_or(tag.len());
        return Some((value_start, value_end));
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

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let needle = needle.as_bytes();
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .as_bytes()
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}

fn parse_page_range_bounds(page_range: &str) -> Option<(usize, usize)> {
    let trimmed = page_range.trim();
    let (start, end) = trimmed.split_once('-').unwrap_or((trimmed, trimmed));
    let start = start.trim().parse::<usize>().ok()?;
    let end = end.trim().parse::<usize>().ok()?;
    if start == 0 || end < start {
        return None;
    }
    Some((start, end))
}

fn remap_chunk_id(chunk_id: &str, offset: u32) -> String {
    let Some(rest) = chunk_id.strip_prefix('p') else {
        return chunk_id.to_string();
    };
    let Some((page, suffix)) = rest.split_once("-c") else {
        return chunk_id.to_string();
    };
    let Ok(page_number) = page.parse::<u32>() else {
        return chunk_id.to_string();
    };
    format!("p{}-c{suffix}", page_number + offset)
}

fn remap_chunk_markdown(markdown: &str, offset: u32) -> String {
    let Some(first_line_end) = markdown.find('\n') else {
        return markdown.to_string();
    };
    let first_line = &markdown[..first_line_end];
    let Some(rest) = first_line.strip_prefix("### [p") else {
        return markdown.to_string();
    };
    let Some((page, suffix)) = rest.split_once("-c") else {
        return markdown.to_string();
    };
    let Ok(page_number) = page.parse::<u32>() else {
        return markdown.to_string();
    };
    let new_page = page_number + offset;
    let mut new_first_line = format!("### [p{}-c{suffix}", new_page);
    if let Some((before_page, _after_page)) = new_first_line.rsplit_once("Page ") {
        new_first_line = format!("{before_page}Page {new_page}");
    }
    format!("{new_first_line}{}", &markdown[first_line_end..])
}

pub fn parse_mineru_result(
    layout_path: &Path,
    markdown_path: &Path,
) -> Result<MinerUParsedDocument> {
    let layout_text = fs::read_to_string(layout_path)
        .with_context(|| format!("failed to read MinerU layout {}", layout_path.display()))?;
    let layout: MinerULayout =
        serde_json::from_str(&layout_text).context("failed to parse MinerU layout JSON")?;
    if layout.pdf_info.is_empty() {
        return Err(anyhow!("MinerU layout has no pages"));
    }

    let markdown = fs::read_to_string(markdown_path)
        .with_context(|| format!("failed to read MinerU markdown {}", markdown_path.display()))?;

    if let Some(content_list_path) = markdown_path
        .parent()
        .and_then(find_mineru_content_list_path)
    {
        let mut document =
            parse_mineru_content_list(&layout, &content_list_path)?.unwrap_or_else(|| {
                parse_layout_text_document(&layout, &markdown)
                    .expect("layout parsing should be valid after layout JSON parsed")
            });
        if document
            .pages
            .iter()
            .all(|page| page.markdown.trim().is_empty())
        {
            document = parse_layout_text_document(&layout, &markdown)?;
        }
        return Ok(document);
    }

    parse_layout_text_document(&layout, &markdown)
}

fn parse_layout_text_document(
    layout: &MinerULayout,
    markdown: &str,
) -> Result<MinerUParsedDocument> {
    let page_markdown = split_markdown_by_pages(markdown, layout.pdf_info.len());

    let mut pages = Vec::new();
    let mut chunks = Vec::new();
    let mut has_approximate_coordinates = false;
    for (fallback_index, page) in layout.pdf_info.iter().enumerate() {
        let page_index = page.page_idx;
        let markdown_for_page = page_markdown
            .get(fallback_index)
            .cloned()
            .unwrap_or_else(String::new);
        let mut page_blocks = page_blocks(page)?;
        has_approximate_coordinates |= page_blocks.iter().any(|block| block.approximate_angle);
        let reading_order = order_page_blocks(&mut page_blocks);

        let block_text = page_blocks
            .iter()
            .map(|block| block.text.as_str())
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        let page_text = if block_text.trim().is_empty() {
            markdown_to_plain_text(&markdown_for_page)
        } else {
            block_text
        };
        let generated_markdown = page_to_markdown(page_index + 1, &page_text);
        let page_markdown = if markdown_for_page.trim().is_empty()
            || reading_order == PageReadingOrder::TwoColumn
        {
            generated_markdown
        } else {
            markdown_for_page
        };

        let page_markdown = if page_markdown.trim().is_empty() {
            page_to_markdown(page_index + 1, &page_text)
        } else {
            page_markdown
        };

        pages.push(ParsedPageInput {
            page_index,
            text: page_text.clone(),
            markdown: page_markdown.clone(),
        });

        for (block_index, block) in page_blocks.into_iter().enumerate() {
            if block.text.trim().is_empty() {
                continue;
            }
            let chunk_id = format!("p{}-c{}", page_index + 1, block_index + 1);
            chunks.push(ParsedChunkInput {
                chunk_id: chunk_id.clone(),
                page_index,
                text: block.text.clone(),
                markdown: format!("### [{chunk_id}] Page {}\n\n{}", page_index + 1, block.text),
                rects: vec![block.rect],
                coordinate_version: COORDINATE_VERSION,
            });
        }

        if chunks.iter().all(|chunk| chunk.page_index != page_index) && !page_text.trim().is_empty()
        {
            let chunk_id = format!("p{}-c1", page_index + 1);
            chunks.push(ParsedChunkInput {
                chunk_id: chunk_id.clone(),
                page_index,
                text: page_text.clone(),
                markdown: format!("### [{chunk_id}] Page {}\n\n{}", page_index + 1, page_text),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            });
        }
    }

    pages.sort_by_key(|page| page.page_index);
    chunks.sort_by(|left, right| {
        left.page_index
            .cmp(&right.page_index)
            .then(left.chunk_id.cmp(&right.chunk_id))
    });
    let text = pages
        .iter()
        .map(|page| page.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(MinerUParsedDocument {
        engine: "mineru-layout".to_string(),
        coordinate_mode: mineru_coordinate_mode(has_approximate_coordinates).to_string(),
        quality: text_quality(&text),
        pages,
        chunks,
    })
}

fn parse_mineru_content_list(
    layout: &MinerULayout,
    content_list_path: &Path,
) -> Result<Option<MinerUParsedDocument>> {
    let content_text = fs::read_to_string(content_list_path).with_context(|| {
        format!(
            "failed to read MinerU content list {}",
            content_list_path.display()
        )
    })?;
    let content_items: Vec<MinerUContentItem> =
        serde_json::from_str(&content_text).context("failed to parse MinerU content_list JSON")?;
    if content_items.is_empty() {
        return Ok(None);
    }

    let mut by_page: BTreeMap<u32, Vec<ContentPageItem>> = BTreeMap::new();
    for item in &content_items {
        if content_list_item_is_noise(&item.item_type) {
            continue;
        }
        let Some(page_index) = item.page_idx else {
            continue;
        };
        let markdown = content_item_markdown(item);
        let text = content_item_text(item);
        if markdown.trim().is_empty() && text.trim().is_empty() {
            continue;
        }
        by_page
            .entry(page_index)
            .or_default()
            .push(ContentPageItem {
                page_index,
                text,
                markdown,
            });
    }

    if by_page.is_empty() {
        return Ok(None);
    }

    let page_indexes = layout
        .pdf_info
        .iter()
        .map(|page| page.page_idx)
        .collect::<Vec<_>>();
    let mut pages = Vec::with_capacity(page_indexes.len());
    let mut chunks = Vec::new();

    for page_index in page_indexes {
        let items = by_page.remove(&page_index).unwrap_or_default();
        let page_text = items
            .iter()
            .map(|item| item.text.as_str())
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        let page_markdown = items
            .iter()
            .map(|item| item.markdown.as_str())
            .filter(|markdown| !markdown.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");

        pages.push(ParsedPageInput {
            page_index,
            text: page_text.clone(),
            markdown: page_markdown,
        });

        for (item_index, item) in items.into_iter().enumerate() {
            let chunk_text = if item.text.trim().is_empty() {
                markdown_to_plain_text(&item.markdown)
            } else {
                item.text
            };
            if chunk_text.trim().is_empty() {
                continue;
            }
            let chunk_id = format!("p{}-c{}", item.page_index + 1, item_index + 1);
            chunks.push(ParsedChunkInput {
                chunk_id: chunk_id.clone(),
                page_index: item.page_index,
                text: chunk_text,
                markdown: format!(
                    "### [{chunk_id}] Page {}\n\n{}",
                    item.page_index + 1,
                    item.markdown
                ),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            });
        }
    }

    for (page_index, items) in by_page {
        let page_text = items
            .iter()
            .map(|item| item.text.as_str())
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        let page_markdown = items
            .iter()
            .map(|item| item.markdown.as_str())
            .filter(|markdown| !markdown.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        pages.push(ParsedPageInput {
            page_index,
            text: page_text,
            markdown: page_markdown,
        });
    }

    pages.sort_by_key(|page| page.page_index);
    chunks.sort_by(|left, right| {
        left.page_index
            .cmp(&right.page_index)
            .then(left.chunk_id.cmp(&right.chunk_id))
    });
    let text = pages
        .iter()
        .map(|page| page.text.as_str())
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(Some(MinerUParsedDocument {
        engine: "mineru-content-list".to_string(),
        coordinate_mode: "text-only".to_string(),
        quality: text_quality(&text),
        pages,
        chunks,
    }))
}

fn find_mineru_content_list_path(output_dir: &Path) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(output_dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with("content_list.json"))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        content_list_rank(left)
            .cmp(&content_list_rank(right))
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });
    candidates.into_iter().next()
}

fn content_list_rank(path: &Path) -> u8 {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if name == "content_list.json" || name.ends_with("_content_list.json") {
        0
    } else {
        1
    }
}

fn content_list_item_is_noise(item_type: &str) -> bool {
    matches!(
        item_type,
        "header" | "footer" | "page_number" | "page_footnote" | "discarded"
    )
}

fn content_item_markdown(item: &MinerUContentItem) -> String {
    match item.item_type.as_str() {
        "text" => content_text_markdown(item),
        "list" => item
            .list_items
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        "image" => media_markdown(
            &item.img_path,
            &item.content,
            item.sub_type.as_deref(),
            &item.image_caption,
            &item.image_footnote,
        ),
        "chart" => media_markdown(
            &item.img_path,
            &item.content,
            item.sub_type.as_deref(),
            &item.chart_caption,
            &item.chart_footnote,
        ),
        "table" => table_markdown(item),
        "equation" => item.text.trim().to_string(),
        _ => item.text.trim().to_string(),
    }
}

fn content_text_markdown(item: &MinerUContentItem) -> String {
    let text = item.text.trim();
    if text.is_empty() {
        return String::new();
    }
    if let Some(level) = item.text_level {
        let depth = usize::from(level.clamp(1, 6));
        format!("{} {}", "#".repeat(depth), text)
    } else {
        text.to_string()
    }
}

fn content_item_text(item: &MinerUContentItem) -> String {
    match item.item_type.as_str() {
        "list" => item
            .list_items
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        "image" => captions_text(&item.image_caption, &item.image_footnote),
        "chart" => captions_text(&item.chart_caption, &item.chart_footnote),
        "table" => {
            let mut parts = Vec::new();
            let caption = captions_text(&item.table_caption, &item.table_footnote);
            if !caption.trim().is_empty() {
                parts.push(caption);
            }
            let body_text = html_table_to_text(&item.table_body);
            if !body_text.trim().is_empty() {
                parts.push(body_text);
            }
            parts.join("\n\n")
        }
        _ => item.text.trim().to_string(),
    }
}

fn table_markdown(item: &MinerUContentItem) -> String {
    let mut parts = Vec::new();
    parts.extend(trimmed_lines(&item.table_caption));
    if !item.table_body.trim().is_empty() {
        parts.push(item.table_body.trim().to_string());
    } else if !item.img_path.trim().is_empty() {
        parts.push(format!("![]({})", item.img_path.trim()));
    }
    parts.extend(trimmed_lines(&item.table_footnote));
    parts.join("\n\n")
}

fn media_markdown(
    image_path: &str,
    content: &str,
    sub_type: Option<&str>,
    captions: &[String],
    footnotes: &[String],
) -> String {
    let mut parts = Vec::new();
    let image_path = image_path.trim();
    if !image_path.is_empty() {
        parts.push(format!("![]({image_path})"));
    }
    let content = content.trim();
    if !content.is_empty() {
        if let Some(sub_type) = sub_type.filter(|value| !value.trim().is_empty()) {
            parts.push(format!(
                "<details>\n<summary>{}</summary>\n\n{}\n</details>",
                escape_html_text(sub_type.trim()),
                content
            ));
        } else {
            parts.push(content.to_string());
        }
    }
    parts.extend(trimmed_lines(captions));
    parts.extend(trimmed_lines(footnotes));
    parts.join("\n\n")
}

fn captions_text(captions: &[String], footnotes: &[String]) -> String {
    trimmed_lines(captions)
        .into_iter()
        .chain(trimmed_lines(footnotes))
        .collect::<Vec<_>>()
        .join("\n")
}

fn trimmed_lines(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn html_table_to_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => {
                in_tag = true;
                text.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    normalize_text(&decode_basic_html_entities(&text))
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn merged_coordinate_mode(documents: &[MinerUParsedDocument]) -> String {
    if documents
        .iter()
        .all(|document| document.coordinate_mode == "text-only")
    {
        return "text-only".to_string();
    }
    let has_approximate_coordinates = documents
        .iter()
        .any(|document| coordinate_mode_is_approximate(&document.coordinate_mode));
    mineru_coordinate_mode(has_approximate_coordinates).to_string()
}

fn merged_engine(documents: &[MinerUParsedDocument]) -> String {
    if documents
        .iter()
        .all(|document| document.engine == "mineru-content-list")
    {
        return "mineru-content-list-batched".to_string();
    }
    "mineru-layout-batched".to_string()
}

fn page_blocks(page: &MinerUPage) -> Result<Vec<PageBlock>> {
    let page_size = PageSize {
        width: page.page_size[0],
        height: page.page_size[1],
    };
    let para_blocks = collect_page_blocks(page, &page.para_blocks, page_size)?;
    if !para_blocks.is_empty() {
        return Ok(para_blocks);
    }
    collect_page_blocks(page, &page.preproc_blocks, page_size)
}

fn collect_page_blocks(
    page: &MinerUPage,
    source_blocks: &[MinerUBlock],
    page_size: PageSize,
) -> Result<Vec<PageBlock>> {
    let mut blocks = Vec::new();
    for block in source_blocks {
        if is_noise_block(&block.block_type) {
            continue;
        }
        let text = normalize_text(&block_text(block));
        if text.trim().is_empty() {
            continue;
        }
        let (rect, approximate_angle) = normalized_block_rect(page, block, page_size)
            .with_context(|| format!("invalid MinerU bbox on page {}", page.page_idx + 1))?;
        blocks.push(PageBlock {
            text,
            approximate_angle,
            rect: NormalizedRectInput {
                page_index: rect.page_index,
                x0: rect.x0,
                y0: rect.y0,
                x1: rect.x1,
                y1: rect.y1,
            },
        });
    }
    Ok(blocks)
}

fn normalized_block_rect(
    page: &MinerUPage,
    block: &MinerUBlock,
    page_size: PageSize,
) -> Result<(crate::coordinates::NormalizedPageRect, bool)> {
    let Some(rotation) = right_angle_rotation(block.angle) else {
        // MinerU can return arbitrary text angles. NormalizedPageRect is axis-aligned,
        // so non-right-angle text remains a best-effort bbox and is surfaced as approximate.
        let rect = mineru_bbox_to_normalized(page.page_idx, block.bbox, page_size)?;
        return Ok((rect, block_has_non_right_angle(block)));
    };
    let rect = top_left_points_to_normalized_with_rotation(
        page.page_idx,
        block.bbox,
        page_size,
        rotation,
    )?;
    Ok((rect, false))
}

#[derive(Debug)]
struct PageBlock {
    text: String,
    approximate_angle: bool,
    rect: NormalizedRectInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageReadingOrder {
    TopLeft,
    TwoColumn,
}

#[derive(Debug, Clone, Copy)]
struct TwoColumnLayout {
    split_x: f64,
    gutter_x: f64,
    median_column_width: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ColumnBand {
    Left,
    Right,
    FullWidth,
}

fn order_page_blocks(blocks: &mut Vec<PageBlock>) -> PageReadingOrder {
    let Some(layout) = detect_two_column_layout(blocks) else {
        blocks.sort_by(top_left_cmp);
        return PageReadingOrder::TopLeft;
    };

    order_two_column_blocks(blocks, layout);
    PageReadingOrder::TwoColumn
}

fn order_two_column_blocks(blocks: &mut Vec<PageBlock>, layout: TwoColumnLayout) {
    let mut order = Vec::with_capacity(blocks.len());
    let mut used = vec![false; blocks.len()];
    let mut wide_blocks = blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| {
            (layout.column_band(block) == ColumnBand::FullWidth).then_some(index)
        })
        .collect::<Vec<_>>();
    wide_blocks.sort_by(|left, right| top_left_cmp(&blocks[*left], &blocks[*right]));

    for wide_index in wide_blocks {
        let cutoff_y = rect_center_y(&blocks[wide_index].rect);
        let mut before = (0..blocks.len())
            .filter(|index| {
                !used[*index]
                    && *index != wide_index
                    && layout.column_band(&blocks[*index]) != ColumnBand::FullWidth
                    && rect_center_y(&blocks[*index].rect) < cutoff_y
            })
            .collect::<Vec<_>>();
        before.sort_by(|left, right| column_major_cmp(layout, &blocks[*left], &blocks[*right]));
        for index in before {
            used[index] = true;
            order.push(index);
        }
        if !used[wide_index] {
            used[wide_index] = true;
            order.push(wide_index);
        }
    }

    let mut remaining = (0..blocks.len())
        .filter(|index| !used[*index])
        .collect::<Vec<_>>();
    remaining.sort_by(|left, right| column_major_cmp(layout, &blocks[*left], &blocks[*right]));
    order.extend(remaining);

    let mut by_index = blocks.drain(..).map(Some).collect::<Vec<_>>();
    for index in order {
        if let Some(block) = by_index[index].take() {
            blocks.push(block);
        }
    }
}

fn detect_two_column_layout(blocks: &[PageBlock]) -> Option<TwoColumnLayout> {
    if blocks.len() < 4 {
        return None;
    }

    let mut candidates = blocks
        .iter()
        .filter(|block| candidate_for_column_detection(block))
        .collect::<Vec<_>>();
    if candidates.len() < 4 {
        return None;
    }
    candidates.sort_by(|left, right| cmp_f64(left.rect.x0, right.rect.x0));

    let mut best_split = None;
    let mut best_gap = 0.0;
    for index in 1..candidates.len() {
        let left_count = index;
        let right_count = candidates.len() - index;
        if left_count < 2 || right_count < 2 {
            continue;
        }
        let gap = candidates[index].rect.x0 - candidates[index - 1].rect.x0;
        if gap > best_gap {
            best_gap = gap;
            best_split = Some(index);
        }
    }

    let split = best_split?;
    if best_gap < 0.12 {
        return None;
    }

    let left = &candidates[..split];
    let right = &candidates[split..];
    let left_x0 = median(left.iter().map(|block| block.rect.x0).collect());
    let left_x1 = median(left.iter().map(|block| block.rect.x1).collect());
    let right_x0 = median(right.iter().map(|block| block.rect.x0).collect());
    let right_x1 = median(right.iter().map(|block| block.rect.x1).collect());
    let split_x = (candidates[split - 1].rect.x0 + candidates[split].rect.x0) / 2.0;
    let gutter_x = (left_x1 + right_x0) / 2.0;
    let median_column_width = median(
        candidates
            .iter()
            .map(|block| rect_width(&block.rect))
            .collect(),
    );

    if !(0.30..=0.70).contains(&gutter_x) {
        return None;
    }
    if right_x0 - left_x0 < 0.25 || right_x1 <= left_x1 {
        return None;
    }

    Some(TwoColumnLayout {
        split_x,
        gutter_x,
        median_column_width,
    })
}

fn candidate_for_column_detection(block: &PageBlock) -> bool {
    let width = rect_width(&block.rect);
    let height = rect_height(&block.rect);
    width > 0.02
        && width < 0.45
        && height > 0.005
        && height < 0.40
        && block.text.chars().filter(|ch| !ch.is_whitespace()).count() >= 3
}

fn column_major_cmp(layout: TwoColumnLayout, left: &PageBlock, right: &PageBlock) -> Ordering {
    layout
        .column_band(left)
        .cmp(&layout.column_band(right))
        .then_with(|| cmp_f64(left.rect.y0, right.rect.y0))
        .then_with(|| cmp_f64(left.rect.x0, right.rect.x0))
}

fn top_left_cmp(left: &PageBlock, right: &PageBlock) -> Ordering {
    cmp_f64(left.rect.y0, right.rect.y0).then_with(|| cmp_f64(left.rect.x0, right.rect.x0))
}

impl TwoColumnLayout {
    fn column_band(self, block: &PageBlock) -> ColumnBand {
        let width = rect_width(&block.rect);
        let spans_gutter =
            block.rect.x0 < self.gutter_x - 0.015 && block.rect.x1 > self.gutter_x + 0.015;
        if spans_gutter && width > self.median_column_width * 1.20 {
            return ColumnBand::FullWidth;
        }
        if block.rect.x0 >= self.split_x || rect_center_x(&block.rect) >= self.gutter_x {
            ColumnBand::Right
        } else {
            ColumnBand::Left
        }
    }
}

impl Ord for ColumnBand {
    fn cmp(&self, other: &Self) -> Ordering {
        column_band_rank(*self).cmp(&column_band_rank(*other))
    }
}

impl PartialOrd for ColumnBand {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn column_band_rank(band: ColumnBand) -> u8 {
    match band {
        ColumnBand::Left => 0,
        ColumnBand::Right => 1,
        ColumnBand::FullWidth => 2,
    }
}

fn rect_width(rect: &NormalizedRectInput) -> f64 {
    rect.x1 - rect.x0
}

fn rect_height(rect: &NormalizedRectInput) -> f64 {
    rect.y1 - rect.y0
}

fn rect_center_x(rect: &NormalizedRectInput) -> f64 {
    (rect.x0 + rect.x1) / 2.0
}

fn rect_center_y(rect: &NormalizedRectInput) -> f64 {
    (rect.y0 + rect.y1) / 2.0
}

fn cmp_f64(left: f64, right: f64) -> Ordering {
    left.partial_cmp(&right).unwrap_or(Ordering::Equal)
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(|left, right| cmp_f64(*left, *right));
    values[values.len() / 2]
}

fn block_has_non_zero_angle(block: &MinerUBlock) -> bool {
    block
        .angle
        .is_some_and(|angle| angle.is_finite() && angle.abs() > ANGLE_EPSILON)
}

fn block_has_non_right_angle(block: &MinerUBlock) -> bool {
    block_has_non_zero_angle(block) && right_angle_rotation(block.angle).is_none()
}

fn right_angle_rotation(angle: Option<f64>) -> Option<i32> {
    let angle = angle?;
    if !angle.is_finite() {
        return None;
    }
    let normalized = angle.rem_euclid(360.0);
    [0, 90, 180, 270]
        .into_iter()
        .find(|&candidate| (normalized - f64::from(candidate)).abs() <= ANGLE_EPSILON)
}

fn mineru_coordinate_mode(has_approximate_coordinates: bool) -> &'static str {
    if has_approximate_coordinates {
        APPROXIMATE_ANGLE_COORDINATE_MODE
    } else {
        PRECISE_COORDINATE_MODE
    }
}

fn coordinate_mode_is_approximate(coordinate_mode: &str) -> bool {
    coordinate_mode
        .split(['-', '_'])
        .any(|part| part.eq_ignore_ascii_case("approx"))
}

fn block_text(block: &MinerUBlock) -> String {
    block
        .lines
        .iter()
        .map(|line| {
            line.spans
                .iter()
                .filter(|span| span.span_type.is_empty() || span.span_type == "text")
                .map(|span| span.content.trim())
                .filter(|content| !content.is_empty())
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_noise_block(block_type: &str) -> bool {
    matches!(
        block_type,
        "header" | "footer" | "page_number" | "footnote" | "discarded"
    )
}

fn split_markdown_by_pages(markdown: &str, page_count: usize) -> Vec<String> {
    if !markdown
        .lines()
        .any(|line| parse_page_marker(line).is_some())
    {
        return vec![String::new(); page_count];
    }

    let mut pages = vec![String::new(); page_count];
    let mut current = 0;
    for line in markdown.lines() {
        if let Some(page_index) = parse_page_marker(line) {
            current = page_index.min(page_count.saturating_sub(1));
            continue;
        }
        if let Some(slot) = pages.get_mut(current) {
            if !slot.is_empty() {
                slot.push('\n');
            }
            slot.push_str(line);
        }
    }
    pages
        .into_iter()
        .enumerate()
        .map(|(index, page)| {
            let body = page.trim();
            if body.is_empty() {
                String::new()
            } else {
                format!("## Page {}\n\n{}", index + 1, body)
            }
        })
        .collect()
}

fn parse_page_marker(line: &str) -> Option<usize> {
    let trimmed = line.trim();
    if !trimmed.starts_with("-----") || !trimmed.contains("page") {
        return None;
    }
    let digits = trimmed
        .chars()
        .skip_while(|ch| !ch.is_ascii_digit())
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    digits
        .parse::<usize>()
        .ok()
        .and_then(|page_number| page_number.checked_sub(1))
}

fn markdown_to_plain_text(markdown: &str) -> String {
    normalize_text(
        &markdown
            .lines()
            .filter(|line| !line.trim_start().starts_with('#'))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn page_to_markdown(page_number: u32, text: &str) -> String {
    let body = text
        .split("\n\n")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    format!("## Page {page_number}\n\n{body}")
}

fn normalize_text(value: &str) -> String {
    let mut normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    while normalized.contains(" \n") || normalized.contains("\t\n") {
        normalized = normalized.replace(" \n", "\n").replace("\t\n", "\n");
    }
    while normalized.contains("\n ") || normalized.contains("\n\t") {
        normalized = normalized.replace("\n ", "\n").replace("\n\t", "\n");
    }
    while normalized.contains("\n\n\n") {
        normalized = normalized.replace("\n\n\n", "\n\n");
    }
    normalized.trim().to_string()
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
        looks_usable: chars.len() > 200
            && replacement_count as f64 / chars.len() as f64 <= 0.01
            && control_count as f64 / chars.len() as f64 <= 0.01,
    }
}

pub fn default_mineru_output_title(output_dir: &Path) -> String {
    output_dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("mineru-book")
        .to_string()
}

pub fn find_original_pdf(output_dir: &Path) -> Result<Option<PathBuf>> {
    let direct_origin = output_dir.join("origin.pdf");
    if direct_origin.is_file() {
        return Ok(Some(direct_origin));
    }

    let mut candidates = fs::read_dir(output_dir)
        .with_context(|| {
            format!(
                "failed to inspect MinerU output directory {}",
                output_dir.display()
            )
        })?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let right_name = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        original_pdf_rank(left_name)
            .cmp(&original_pdf_rank(right_name))
            .then(left_name.cmp(right_name))
    });
    Ok(candidates.into_iter().next())
}

fn original_pdf_rank(file_name: &str) -> u8 {
    let lower = file_name.to_lowercase();
    if lower == "origin.pdf" {
        0
    } else if lower.ends_with("_origin.pdf") {
        1
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mineru_layout_blocks_into_normalized_chunk_rects() {
        let temp_dir = std::env::temp_dir().join(format!(
            "focused-reading-mineru-parser-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            temp_dir.join("layout.json"),
            r#"{
              "pdf_info": [
                {
                  "page_idx": 0,
                  "page_size": [595, 841],
                  "para_blocks": [
                    {
                      "bbox": [67, 63, 359, 80],
                      "type": "text",
                      "lines": [
                        {
                          "spans": [
                            {"type": "text", "content": "财富公式"}
                          ]
                        }
                      ]
                    },
                    {
                      "bbox": [30, 820, 40, 830],
                      "type": "page_number",
                      "lines": [{"spans": [{"type": "text", "content": "1"}]}]
                    }
                  ],
                  "preproc_blocks": []
                }
              ]
            }"#,
        )
        .unwrap();
        fs::write(temp_dir.join("full.md"), "财富公式").unwrap();

        let parsed = parse_mineru_output_dir(&temp_dir).unwrap();
        assert_eq!(parsed.pages.len(), 1);
        assert_eq!(parsed.chunks.len(), 1);
        assert_eq!(parsed.chunks[0].text, "财富公式");
        assert_eq!(parsed.chunks[0].rects.len(), 1);
        assert_eq!(parsed.chunks[0].rects[0].x0, 67.0 / 595.0);
        assert_eq!(parsed.chunks[0].rects[0].y0, 63.0 / 841.0);
        assert_eq!(parsed.coordinate_mode, "normalized-page-rects");
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn does_not_duplicate_para_and_preproc_blocks() {
        let temp_dir = std::env::temp_dir().join(format!(
            "focused-reading-mineru-parser-duplicate-blocks-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            temp_dir.join("layout.json"),
            r#"{
              "pdf_info": [
                {
                  "page_idx": 0,
                  "page_size": [600, 800],
                  "para_blocks": [
                    {
                      "bbox": [60, 80, 300, 120],
                      "type": "title",
                      "lines": [{"spans": [{"type": "text", "content": "Doc-V title"}]}]
                    },
                    {
                      "bbox": [60, 140, 300, 180],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Abstract body"}]}]
                    }
                  ],
                  "preproc_blocks": [
                    {
                      "bbox": [60, 80, 300, 120],
                      "type": "title",
                      "lines": [{"spans": [{"type": "text", "content": "Doc-V title"}]}]
                    },
                    {
                      "bbox": [60, 140, 300, 180],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Abstract body"}]}]
                    }
                  ]
                }
              ]
            }"#,
        )
        .unwrap();
        fs::write(temp_dir.join("full.md"), "Doc-V title\n\nAbstract body").unwrap();

        let parsed = parse_mineru_output_dir(&temp_dir).unwrap();
        assert_eq!(parsed.chunks.len(), 2);
        assert_eq!(parsed.pages[0].text.matches("Doc-V title").count(), 1);
        assert_eq!(parsed.pages[0].text.matches("Abstract body").count(), 1);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn prefers_mineru_content_list_markdown_without_page_separators() {
        let temp_dir = std::env::temp_dir().join(format!(
            "focused-reading-mineru-parser-content-list-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            temp_dir.join("layout.json"),
            r#"{
              "pdf_info": [
                {
                  "page_idx": 0,
                  "page_size": [600, 800],
                  "para_blocks": [
                    {
                      "bbox": [60, 80, 300, 120],
                      "type": "title",
                      "lines": [{"spans": [{"type": "text", "content": "Fallback title"}]}]
                    }
                  ],
                  "preproc_blocks": []
                },
                {
                  "page_idx": 1,
                  "page_size": [600, 800],
                  "para_blocks": [
                    {
                      "bbox": [60, 80, 300, 120],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Fallback page two"}]}]
                    }
                  ],
                  "preproc_blocks": []
                }
              ]
            }"#,
        )
        .unwrap();
        fs::write(
            temp_dir.join("full.md"),
            "# MinerU Title\n\n![](images/figure one.png)\n\n# 2. Related Work",
        )
        .unwrap();
        fs::write(
            temp_dir.join("abc_content_list.json"),
            r#"[
              {
                "type": "text",
                "text": "MinerU Title ",
                "text_level": 1,
                "page_idx": 0
              },
              {
                "type": "image",
                "img_path": "images/figure one.png",
                "image_caption": ["Figure 1. MinerU image. "],
                "image_footnote": [],
                "content": "```mermaid\ngraph TD\n  A --> B\n```",
                "sub_type": "flowchart",
                "page_idx": 0
              },
              {
                "type": "text",
                "text": "2. Related Work ",
                "text_level": 1,
                "page_idx": 1
              },
              {
                "type": "table",
                "table_caption": ["Table 1. Results. "],
                "table_footnote": [],
                "table_body": "<table><tr><td rowspan=\"2\">Method</td><td>Score</td></tr></table>",
                "page_idx": 1
              }
            ]"#,
        )
        .unwrap();

        let parsed = parse_mineru_output_dir(&temp_dir).unwrap();

        assert_eq!(parsed.engine, "mineru-content-list");
        assert_eq!(parsed.coordinate_mode, "text-only");
        assert_eq!(parsed.pages.len(), 2);
        assert!(parsed.pages[0].markdown.starts_with("# MinerU Title"));
        assert!(parsed.pages[0]
            .markdown
            .contains("![](images/figure one.png)"));
        assert!(parsed.pages[0].markdown.contains("<details>"));
        assert!(parsed.pages[0].markdown.contains("Figure 1. MinerU image."));
        assert!(parsed.pages[1].markdown.starts_with("# 2. Related Work"));
        assert!(parsed.pages[1]
            .markdown
            .contains("<td rowspan=\"2\">Method</td>"));
        assert!(!parsed.pages[0].markdown.contains("## Page"));
        assert!(!parsed.pages[1].markdown.contains("## Page"));
        assert_eq!(parsed.chunks[0].rects.len(), 0);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn orders_two_column_pages_by_column_reading_flow() {
        let temp_dir = std::env::temp_dir().join(format!(
            "focused-reading-mineru-parser-two-column-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            temp_dir.join("layout.json"),
            r#"{
              "pdf_info": [
                {
                  "page_idx": 0,
                  "page_size": [600, 800],
                  "para_blocks": [
                    {
                      "bbox": [150, 40, 450, 70],
                      "type": "title",
                      "lines": [{"spans": [{"type": "text", "content": "Doc-V Title"}]}]
                    },
                    {
                      "bbox": [165, 78, 435, 98],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Author list"}]}]
                    },
                    {
                      "bbox": [80, 125, 270, 260],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Abstract left column."}]}]
                    },
                    {
                      "bbox": [330, 125, 520, 260],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Abstract right column."}]}]
                    },
                    {
                      "bbox": [80, 290, 270, 330],
                      "type": "title",
                      "lines": [{"spans": [{"type": "text", "content": "1 Introduction"}]}]
                    },
                    {
                      "bbox": [80, 340, 270, 500],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Introduction continues on the left."}]}]
                    },
                    {
                      "bbox": [330, 290, 520, 500],
                      "type": "text",
                      "lines": [{"spans": [{"type": "text", "content": "Right column starts after left column."}]}]
                    }
                  ],
                  "preproc_blocks": []
                }
              ]
            }"#,
        )
        .unwrap();
        fs::write(
            temp_dir.join("full.md"),
            "Doc-V Title\n\nAuthor list\n\nAbstract left column.\n\nAbstract right column.\n\n1 Introduction",
        )
        .unwrap();

        let parsed = parse_mineru_output_dir(&temp_dir).unwrap();
        let page_text = &parsed.pages[0].text;
        assert_order(page_text, "Abstract left column.", "1 Introduction");
        assert_order(
            page_text,
            "Introduction continues on the left.",
            "Abstract right column.",
        );
        assert_order(
            page_text,
            "Abstract right column.",
            "Right column starts after left column.",
        );
        assert_eq!(parsed.chunks[0].text, "Doc-V Title");
        assert_eq!(parsed.chunks[2].text, "Abstract left column.");
        assert_eq!(parsed.chunks[3].text, "1 Introduction");
        assert_eq!(parsed.chunks[5].text, "Abstract right column.");
        assert!(parsed.pages[0]
            .markdown
            .contains("Introduction continues on the left.\n\nAbstract right column."));
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn keeps_single_column_pages_in_top_left_order() {
        let mut blocks = vec![
            test_block("Title", 0.20, 0.05, 0.80, 0.08),
            test_block("Main paragraph one.", 0.12, 0.12, 0.88, 0.18),
            test_block("Indented equation.", 0.45, 0.22, 0.70, 0.25),
            test_block("Main paragraph two.", 0.12, 0.30, 0.88, 0.36),
            test_block("Indented note.", 0.46, 0.42, 0.72, 0.46),
        ];

        let order = order_page_blocks(&mut blocks);
        assert_eq!(order, PageReadingOrder::TopLeft);
        assert_eq!(
            blocks
                .iter()
                .map(|block| block.text.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Title",
                "Main paragraph one.",
                "Indented equation.",
                "Main paragraph two.",
                "Indented note."
            ]
        );
    }

    #[test]
    fn marks_mineru_non_zero_angle_coordinates_as_approximate() {
        let temp_dir = std::env::temp_dir().join(format!(
            "focused-reading-mineru-parser-angle-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            temp_dir.join("layout.json"),
            r#"{
              "pdf_info": [
                {
                  "page_idx": 0,
                  "page_size": [600, 800],
                  "para_blocks": [
                    {
                      "bbox": [60, 80, 300, 120],
                      "angle": 12,
                      "type": "text",
                      "lines": [
                        {
                          "spans": [
                            {"type": "text", "content": "旋转文本"}
                          ]
                        }
                      ]
                    }
                  ],
                  "preproc_blocks": []
                }
              ]
            }"#,
        )
        .unwrap();
        fs::write(temp_dir.join("full.md"), "旋转文本").unwrap();

        let parsed = parse_mineru_output_dir(&temp_dir).unwrap();
        assert_eq!(parsed.coordinate_mode, "normalized-page-rects-approx-angle");
        assert_eq!(parsed.chunks[0].rects.len(), 1);
        assert_eq!(parsed.chunks[0].rects[0].x0, 60.0 / 600.0);
        assert_eq!(parsed.chunks[0].rects[0].y0, 80.0 / 800.0);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn applies_mineru_right_angle_rotation_precisely() {
        let temp_dir = std::env::temp_dir().join(format!(
            "focused-reading-mineru-parser-right-angle-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            temp_dir.join("layout.json"),
            r#"{
              "pdf_info": [
                {
                  "page_idx": 0,
                  "page_size": [200, 400],
                  "para_blocks": [
                    {
                      "bbox": [10, 20, 110, 120],
                      "angle": 90,
                      "type": "text",
                      "lines": [
                        {
                          "spans": [
                            {"type": "text", "content": "直角旋转文本"}
                          ]
                        }
                      ]
                    }
                  ],
                  "preproc_blocks": []
                }
              ]
            }"#,
        )
        .unwrap();
        fs::write(temp_dir.join("full.md"), "直角旋转文本").unwrap();

        let parsed = parse_mineru_output_dir(&temp_dir).unwrap();
        assert_eq!(parsed.coordinate_mode, "normalized-page-rects");
        assert_eq!(parsed.chunks[0].rects.len(), 1);
        assert_eq!(parsed.chunks[0].rects[0].x0, 280.0 / 400.0);
        assert_eq!(parsed.chunks[0].rects[0].y0, 10.0 / 200.0);
        assert_eq!(parsed.chunks[0].rects[0].x1, 380.0 / 400.0);
        assert_eq!(parsed.chunks[0].rects[0].y1, 110.0 / 200.0);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    fn assert_order(text: &str, before: &str, after: &str) {
        let before_index = text.find(before).expect("missing before text");
        let after_index = text.find(after).expect("missing after text");
        assert!(
            before_index < after_index,
            "expected {before:?} before {after:?} in {text:?}"
        );
    }

    fn test_block(text: &str, x0: f64, y0: f64, x1: f64, y1: f64) -> PageBlock {
        PageBlock {
            text: text.to_string(),
            approximate_angle: false,
            rect: NormalizedRectInput {
                page_index: 0,
                x0,
                y0,
                x1,
                y1,
            },
        }
    }

    #[test]
    fn finds_original_pdf_in_mineru_output() {
        let temp_dir = std::env::temp_dir().join(format!(
            "focused-reading-mineru-origin-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(temp_dir.join("book.pdf"), b"ordinary").unwrap();
        fs::write(temp_dir.join("abc_origin.pdf"), b"origin").unwrap();

        let original = find_original_pdf(&temp_dir)
            .unwrap()
            .expect("origin PDF should be found");
        assert_eq!(
            original.file_name().and_then(|name| name.to_str()),
            Some("abc_origin.pdf")
        );
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn merges_batched_documents_by_original_page_index() {
        let document = merge_mineru_documents(vec![
            MinerUParsedDocument {
                engine: "mineru-layout".to_string(),
                coordinate_mode: "normalized-page-rects-approx-angle".to_string(),
                quality: TextQuality {
                    char_count: 1,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: false,
                },
                pages: vec![ParsedPageInput {
                    page_index: 2,
                    text: "第三页".to_string(),
                    markdown: "## Page 3\n\n第三页".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p3-c1".to_string(),
                    page_index: 2,
                    text: "第三页".to_string(),
                    markdown: "### [p3-c1] Page 3\n\n第三页".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
            MinerUParsedDocument {
                engine: "mineru-layout".to_string(),
                coordinate_mode: "normalized-page-rects".to_string(),
                quality: TextQuality {
                    char_count: 1,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: false,
                },
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "第一页".to_string(),
                    markdown: "## Page 1\n\n第一页".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "第一页".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n第一页".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        ])
        .expect("documents should merge");

        assert_eq!(document.engine, "mineru-layout-batched");
        assert_eq!(
            document.coordinate_mode,
            "normalized-page-rects-approx-angle"
        );
        assert_eq!(
            document
                .pages
                .iter()
                .map(|page| page.page_index)
                .collect::<Vec<_>>(),
            vec![0, 2]
        );
        assert_eq!(document.chunks[0].chunk_id, "p1-c1");
        assert_eq!(document.chunks[1].chunk_id, "p3-c1");
    }

    #[test]
    fn marks_batched_content_list_documents_as_current_mineru_engine() {
        let document = merge_mineru_documents(vec![
            MinerUParsedDocument {
                engine: "mineru-content-list".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: TextQuality {
                    char_count: 1,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                },
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "第一页".to_string(),
                    markdown: "# 第一页".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "第一页".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n# 第一页".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
            MinerUParsedDocument {
                engine: "mineru-content-list".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: TextQuality {
                    char_count: 1,
                    replacement_char_ratio: 0.0,
                    control_char_ratio: 0.0,
                    looks_usable: true,
                },
                pages: vec![ParsedPageInput {
                    page_index: 1,
                    text: "第二页".to_string(),
                    markdown: "# 第二页".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p2-c1".to_string(),
                    page_index: 1,
                    text: "第二页".to_string(),
                    markdown: "### [p2-c1] Page 2\n\n# 第二页".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        ])
        .expect("documents should merge");

        assert_eq!(document.engine, "mineru-content-list-batched");
        assert_eq!(document.coordinate_mode, "text-only");
        assert_eq!(
            document
                .pages
                .iter()
                .map(|page| page.markdown.as_str())
                .collect::<Vec<_>>(),
            vec!["# 第一页", "# 第二页"]
        );
    }

    #[test]
    fn remaps_relative_batch_pages_when_mineru_resets_page_indexes() {
        let document = MinerUParsedDocument {
            engine: "mineru-layout".to_string(),
            coordinate_mode: "normalized-page-rects".to_string(),
            quality: TextQuality {
                char_count: 1,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: false,
            },
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "第 201 页".to_string(),
                markdown: "## Page 1\n\n第 201 页".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "第 201 页".to_string(),
                markdown: "### [p1-c1] Page 1\n\n第 201 页".to_string(),
                rects: vec![NormalizedRectInput {
                    page_index: 0,
                    x0: 0.1,
                    y0: 0.1,
                    x1: 0.2,
                    y1: 0.2,
                }],
                coordinate_version: COORDINATE_VERSION,
            }],
        };

        let remapped = remap_relative_batch_pages(document, Some("201-400"));
        assert_eq!(remapped.pages[0].page_index, 200);
        assert_eq!(remapped.chunks[0].page_index, 200);
        assert_eq!(remapped.chunks[0].chunk_id, "p201-c1");
        assert!(remapped.chunks[0]
            .markdown
            .starts_with("### [p201-c1] Page 201"));
        assert_eq!(remapped.chunks[0].rects[0].page_index, 200);
    }

    #[test]
    fn does_not_remap_when_batch_pages_are_already_absolute() {
        let document = MinerUParsedDocument {
            engine: "mineru-layout".to_string(),
            coordinate_mode: "normalized-page-rects".to_string(),
            quality: TextQuality {
                char_count: 1,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: false,
            },
            pages: vec![ParsedPageInput {
                page_index: 200,
                text: "第 201 页".to_string(),
                markdown: "## Page 201\n\n第 201 页".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p201-c1".to_string(),
                page_index: 200,
                text: "第 201 页".to_string(),
                markdown: "### [p201-c1] Page 201\n\n第 201 页".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        };

        let remapped = remap_relative_batch_pages(document, Some("201-400"));
        assert_eq!(remapped.pages[0].page_index, 200);
        assert_eq!(remapped.chunks[0].chunk_id, "p201-c1");
    }

    #[test]
    fn prefixes_relative_markdown_asset_paths_for_batched_outputs() {
        let document = MinerUParsedDocument {
            engine: "mineru-layout".to_string(),
            coordinate_mode: "normalized-page-rects".to_string(),
            quality: TextQuality {
                char_count: 1,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: false,
            },
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "图文页".to_string(),
                markdown: "## Page 1\n\n![figure](images/a b.png)\n\n<table><tr><td><img src=\"images/table cell.png\"/></td></tr></table>\n\n[外链](https://example.com)"
                    .to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "图文页".to_string(),
                markdown: "### [p1-c1] Page 1\n\n![figure](images/a b.png)".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        };

        let prefixed = prefix_relative_markdown_asset_paths(document, "batch-1");
        assert!(prefixed.pages[0]
            .markdown
            .contains("![figure](batch-1/images/a"));
        assert!(prefixed.pages[0]
            .markdown
            .contains("<img src=\"batch-1/images/table cell.png\"/>"));
        assert!(prefixed.pages[0]
            .markdown
            .contains("[外链](https://example.com)"));
        assert!(prefixed.chunks[0]
            .markdown
            .contains("![figure](batch-1/images/a"));
    }
}
