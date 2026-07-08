use super::*;

pub(super) fn format_knowledge_context_for_prompt(context: &knowledge::KnowledgeContextResponse) -> String {
    let mut output = String::new();
    output.push_str("知识体系上下文：\n");
    output.push_str("注意：以下 card_id 只用于理解关系，最终回答不能引用 card_id，只能引用 evidence chunk_id。\n");
    output.push_str(&format!(
        "- query: {}\n- matched_cards: {}\n- graph_edges: {}\n- map_stations: {}\n",
        trim_for_prompt(&context.query, 120),
        context.cards.len(),
        context.edges.len(),
        context.station_count
    ));
    if !context.cards.is_empty() {
        output.push_str("卡片：\n");
        for card in context.cards.iter().take(MAX_KNOWLEDGE_CONTEXT_CARDS) {
            output.push_str(&format!(
                "- {} [{} / {} / {:.0}%] evidence=[{}]\n  {}\n",
                trim_for_prompt(&card.title, 80),
                card.card_type,
                card.status,
                card.confidence * 100.0,
                card.evidence_chunk_ids
                    .iter()
                    .take(6)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", "),
                trim_for_prompt(&card.summary, 180)
            ));
        }
    }
    if !context.edges.is_empty() {
        output.push_str("关系：\n");
        for edge in context.edges.iter().take(MAX_KNOWLEDGE_CONTEXT_EDGES) {
            output.push_str(&format!(
                "- {}: {} -> {} evidence=[{}]\n",
                edge.label,
                trim_for_prompt(&edge.source_title, 60),
                trim_for_prompt(&edge.target_title, 60),
                edge.evidence_chunk_ids
                    .iter()
                    .take(6)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    output
}

pub(super) fn synthesis_knowledge_context(
    db_path: &std::path::Path,
    request: &InterpretRequest,
) -> Option<String> {
    let mut sections = Vec::new();
    for query in evidence_queries(request).into_iter().take(3) {
        let Ok(context) =
            knowledge::knowledge_context_for_query(db_path, &request.book_id, &query, 5)
        else {
            continue;
        };
        if context.cards.is_empty() && context.edges.is_empty() {
            continue;
        }
        sections.push(format_knowledge_context_for_prompt(&context));
    }
    if sections.is_empty() {
        None
    } else {
        Some(trim_for_prompt(&sections.join("\n\n"), 3_600))
    }
}

pub(super) fn build_messages(
    request: &InterpretRequest,
    evidence: &[EvidenceItem],
    knowledge_context: Option<&str>,
) -> Vec<ChatMessage> {
    let system = [
        "你是“框选精读”的阅读助理。",
        "用户会框选一段转换后的书中文字。你必须始终以这段原文为不可动摇的焦点，不能漂移到泛泛总结整本书。",
        "你只能使用给出的 evidence chunks 作为书内依据。每个关键判断后都用对应的 [chunk_id] 标注依据。",
        "如果证据不足，明确说证据不足，并说明还需要什么证据。不要编造引用。",
        "回答使用中文，结构清楚，避免空泛鸡汤。",
    ]
    .join("\n");
    let evidence_text = if evidence.is_empty() {
        "没有检索到可用 evidence chunks。".to_string()
    } else {
        evidence
            .iter()
            .map(|item| {
                format!(
                    "[{}] page {}\n{}",
                    item.chunk_id,
                    item.page_index + 1,
                    trim_for_prompt(&item.text, 900)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let mode_instruction = match request.mode {
        InterpretMode::Deep => {
            "请给出深度解读：先解释这段话在说什么，再说明它在上下文中的作用、可能的隐含前提、与证据 chunk 的关联。至少使用 2 条引用，除非证据不足。"
        }
        InterpretMode::Plain => "请用更直白的话解释这段话，并给出必要的上下文依据。",
        InterpretMode::Apply => {
            "请给出应用/迁移解读：先提炼这段话在书内证据支持下成立的原则，再说明它可迁移到什么场景、迁移条件和限制。所有原则、条件、限制都必须用 [chunk_id] 接地；不要给没有证据的空泛建议。"
        }
    };
    let question = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
        .map(|question| format!("\n用户追问：{question}"))
        .unwrap_or_default();
    let prior_answer = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
        .map(|answer| format!("\n上一轮解读摘要：\n{}", trim_for_prompt(answer, 700)))
        .unwrap_or_default();
    let follow_up_context = if request.follow_up_history.is_empty() {
        String::new()
    } else {
        let turns = request
            .follow_up_history
            .iter()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|turn| {
                format!(
                    "Q: {}\nA: {}",
                    trim_for_prompt(&turn.question, 180),
                    trim_for_prompt(&turn.answer, 360)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        format!("\n已有追问上下文：\n{turns}")
    };
    let user = format!(
        "框选文本：\n{}\n{}{}{}\n\nKnowledge context:\n{}\n\nEvidence chunks:\n{}\n\n{}",
        request.selection_text.trim(),
        question,
        prior_answer,
        follow_up_context,
        knowledge_context.unwrap_or("没有可用知识体系上下文。"),
        evidence_text,
        mode_instruction
    );

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

#[cfg(test)]
pub(super) fn build_tool_planning_messages(request: &InterpretRequest) -> Vec<ChatMessage> {
    let question = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
        .unwrap_or("请为这段话做深度解读。");
    let prior = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
        .map(|answer| format!("\n上一轮解读：{}", trim_for_prompt(answer, 400)))
        .unwrap_or_default();
    let system = [
        "你是“框选精读”的检索规划器。",
        "你只能为当前书籍调用提供的检索工具，不能直接回答。",
        "必须始终围绕用户逐字框选的文本规划检索，不要泛化成整本书摘要。",
        "优先调用 get_knowledge_context、search_knowledge 和 search_book；如果已有 chunk_id，可调用 get_chunk 或 get_neighbors；证据不足时调用 list_structure。",
        "get_knowledge_context 会返回知识卡片、关系边和地图站点摘要；search_knowledge 返回知识卡片命中的原文 evidence chunks；最终回答仍必须引用 chunk_id，不要引用知识卡片 ID。",
    ]
    .join("\n");
    let user = format!(
        "框选文本：\n{}\n\n用户问题：{}\n当前页索引：{:?}\n焦点 chunk：{:?}{}",
        request.selection_text.trim(),
        question,
        request.page_indexes,
        request.focus_chunk_ids,
        prior
    );

    vec![ChatMessage::system(system), ChatMessage::user(user)]
}

pub(super) fn build_tool_loop_messages(
    request: &InterpretRequest,
    history: &[ToolLoopRound],
    round_index: usize,
) -> Vec<ChatMessage> {
    let question = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
        .unwrap_or("请为这段话做深度解读。");
    let prior = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
        .map(|answer| format!("\n上一轮解读：{}", trim_for_prompt(answer, 420)))
        .unwrap_or_default();
    let follow_up_context = if request.follow_up_history.is_empty() {
        String::new()
    } else {
        let turns = request
            .follow_up_history
            .iter()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|turn| {
                format!(
                    "Q: {}\nA: {}",
                    trim_for_prompt(&turn.question, 160),
                    trim_for_prompt(&turn.answer, 260)
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        format!("\n已有追问上下文：\n{turns}")
    };
    let system = [
        "你是“框选精读”的 agentic RAG 检索器。",
        "你只能为当前书籍调用提供的检索工具，不能直接给最终解读。",
        "必须逐轮围绕用户逐字框选的文本和追问检索证据，不要泛化成整本书摘要。",
        "每一轮读取上一轮工具结果后，判断还缺什么证据；如果还缺定义、上下文、呼应、反例或追问相关证据，就继续调用工具。",
        "如果已有足够证据，可以不调用工具；后端会进入合成阶段。",
        "可用工具：get_knowledge_context / search_knowledge / search_book / get_chunk / get_neighbors / list_structure。",
        "get_knowledge_context 返回知识卡片、关系边和地图站点摘要；search_knowledge 返回知识卡片命中的原文 evidence chunks；知识卡片不能作为最终引用，最终只写 [chunk_id]。",
    ]
    .join("\n");
    let user = format!(
        "第 {} 轮检索。\n\n{}",
        round_index + 1,
        if round_index == 0 {
            format!(
                "框选文本：\n{}\n\n用户问题：{}\n当前页索引：{:?}\n焦点 chunk：{:?}{}{}\n\n请只通过工具继续检索需要的书内证据；如证据已经足够，可以不调用工具。",
                request.selection_text.trim(),
                question,
                request.page_indexes,
                request.focus_chunk_ids,
                prior,
                follow_up_context
            )
        } else {
            format!(
                "检索目标保持不变。\n框选文本摘要：{}\n用户问题：{}\n焦点 chunk：{:?}\n\n请读取上一轮工具结果，只针对仍缺的定义、上下文、呼应、反例或追问相关证据继续调用工具；如证据已经足够，可以不调用工具。",
                trim_for_prompt(request.selection_text.trim(), 180),
                trim_for_prompt(question, 120),
                request.focus_chunk_ids
            )
        }
    );

    let mut messages = vec![ChatMessage::system(system), ChatMessage::user(user)];
    for (history_index, round) in history.iter().enumerate() {
        let include_text_snippets = history_index + 1 == history.len();
        messages.push(ChatMessage::assistant(
            round.model_note.clone(),
            round.tool_calls.clone(),
        ));
        for execution in &round.executions {
            messages.push(ChatMessage::tool_result(
                execution.tool_call_id.clone(),
                format_tool_execution_result_for_model(execution, include_text_snippets),
            ));
        }
    }
    messages
}

pub(super) fn retrieval_tool_definitions() -> Vec<ToolDefinition> {
    llm::book_retrieval_tools()
}

pub(super) fn trim_for_prompt(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let hard_limit = trimmed.chars().take(max_chars).collect::<String>();
    let min_sentence_chars = max_chars.saturating_mul(2) / 3;
    let mut best_boundary = None;
    for (byte_index, ch) in hard_limit.char_indices() {
        if is_sentence_boundary(ch)
            && hard_limit[..byte_index].chars().count() >= min_sentence_chars
        {
            best_boundary = Some(byte_index + ch.len_utf8());
        }
    }
    let mut output = best_boundary
        .map(|byte_index| hard_limit[..byte_index].trim_end().to_string())
        .unwrap_or(hard_limit);
    output.push('…');
    output
}

pub(super) fn is_sentence_boundary(ch: char) -> bool {
    matches!(ch, '。' | '！' | '？' | '.' | '!' | '?')
}

pub(super) fn trim_for_query(text: &str, max_chars: usize) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(max_chars).collect()
}
