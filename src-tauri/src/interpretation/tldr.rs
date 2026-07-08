use super::*;

const TLDR_STRUCTURE_CHAR_BUDGET: usize = 8_000;
const TLDR_CHUNK_MAX_TOKENS: u32 = 4_000;
const TLDR_MAX_CONTINUATIONS: usize = 3;

pub async fn generate_document_tldr(
    db_path: &Path,
    book_id: &str,
) -> Result<String, llm::LlmError> {
    let structure =
        storage::list_structure(db_path, book_id).map_err(|err| llm::LlmError::Provider {
            status: 500,
            body: format!("failed to read document structure: {err:#}"),
        })?;
    let prompt_context = tldr_structure_context(&structure);
    let messages = build_tldr_messages(&prompt_context);
    let mut response = llm::chat_text(messages.clone(), TLDR_CHUNK_MAX_TOKENS).await?;
    let mut output = response.content.clone();
    let mut continuation_count = 0;
    while response.stopped_by_token_limit() && continuation_count < TLDR_MAX_CONTINUATIONS {
        continuation_count += 1;
        let mut continuation_messages = messages.clone();
        continuation_messages.push(ChatMessage::assistant(output.clone(), Vec::new()));
        continuation_messages.push(ChatMessage::user(
            "刚才的 TLDR 因输出上限中断了。请从最后一句之后自然续写，继续补完剩余内容。不要重复已经写过的内容，不要写标题、道歉或说明，只输出续写正文。",
        ));
        response = llm::chat_text(continuation_messages, TLDR_CHUNK_MAX_TOKENS).await?;
        append_tldr_continuation(&mut output, &response.content);
    }
    Ok(clean_tldr_text(&output))
}

pub(super) fn build_tldr_messages(prompt_context: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage::system(
            "你是一位精读助手。只输出读者可见的 TLDR 正文，不输出任何关于任务、提示词、片段来源、资料类型或写作限制的说明。不要写“需要先说明”“你提供的片段”“这些片段并非”“以下 TLDR”这类元话语。信息完整优先，不要人为压缩到固定字数；如果内容很多，就自然分成多个段落写完整。",
        ),
        ChatMessage::user(format!(
            "请基于下面的文档结构与代表内容，写一份帮助读者快速了解整本文档的 TLDR。先判断材料类型，再直接概括其核心内容、主线/问题、重要推进、关键人物或概念、结论/价值。不要套用不符合材料类型的体裁标签；不要解释你如何写摘要；不要提到“片段”“提示”“上下文”。根据内容自然展开，写完整，不要截断。\n\n文档结构与代表内容：\n{}",
            prompt_context
        )),
    ]
}

pub(super) fn tldr_structure_context(structure: &[storage::SearchHit]) -> String {
    let mut output = String::new();
    for hit in representative_tldr_hits(structure) {
        let text = trim_for_prompt(&hit.text, 700);
        if text.trim().is_empty() {
            continue;
        }
        let row = format!(
            "[{}] page {}\n{}\n\n",
            hit.chunk_id,
            hit.page_index + 1,
            text.trim()
        );
        if output.chars().count() + row.chars().count() > TLDR_STRUCTURE_CHAR_BUDGET {
            break;
        }
        output.push_str(&row);
    }
    if output.trim().is_empty() {
        "没有可用的文档结构片段。".to_string()
    } else {
        output
    }
}

pub(super) fn representative_tldr_hits(structure: &[storage::SearchHit]) -> Vec<&storage::SearchHit> {
    if structure.len() <= 24 {
        return structure.iter().collect();
    }
    let mut selected = Vec::new();
    selected.extend(structure.iter().take(12));
    let middle_start = structure.len().saturating_div(2).saturating_sub(3);
    selected.extend(structure.iter().skip(middle_start).take(6));
    selected.extend(structure.iter().rev().take(8));
    selected.sort_by(|left, right| {
        left.page_index
            .cmp(&right.page_index)
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
    });
    selected.dedup_by(|left, right| left.chunk_id == right.chunk_id);
    selected
}

pub(super) fn clean_tldr_text(text: &str) -> String {
    let compact = text.lines().map(str::trim).collect::<Vec<_>>().join("\n");
    let normalized = compact
        .split("\n\n")
        .map(|paragraph| {
            paragraph
                .lines()
                .filter(|line| !line.trim().is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|paragraph| !paragraph.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    normalized
        .trim_matches(|ch: char| ch == '"' || ch == '“' || ch == '”')
        .trim()
        .to_string()
}

pub(super) fn append_tldr_continuation(output: &mut String, continuation: &str) {
    let continuation = continuation.trim();
    if continuation.is_empty() {
        return;
    }
    if !output.trim().is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(continuation);
}
