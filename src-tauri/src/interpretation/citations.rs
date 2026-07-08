use super::*;

pub(super) fn enforce_grounded_citations(
    answer: &str,
    request: &InterpretRequest,
    evidence: &[EvidenceItem],
) -> String {
    if evidence.is_empty() {
        return fallback_grounded_answer(request, evidence, None);
    }
    let allowed = evidence
        .iter()
        .map(|item| item.chunk_id.as_str())
        .collect::<BTreeSet<_>>();
    let (mut cleaned, valid_count) = rewrite_chunk_citations(answer, &allowed);
    cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        return fallback_grounded_answer(request, evidence, None);
    }
    if valid_count == 0 {
        cleaned.push_str("\n\n可核对证据：");
        cleaned.push_str(&evidence_citation_footer(evidence, 3));
    }
    cleaned
}

pub(super) fn rewrite_chunk_citations(answer: &str, allowed: &BTreeSet<&str>) -> (String, usize) {
    let chars = answer.chars().collect::<Vec<_>>();
    let mut output = String::new();
    let mut valid_count = 0;
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '[' || chars[index] == '【' {
            let closing = if chars[index] == '[' { ']' } else { '】' };
            if let Some(close_offset) = chars[index + 1..]
                .iter()
                .take(160)
                .position(|ch| *ch == closing)
            {
                let close_index = index + 1 + close_offset;
                let candidate = chars[index + 1..close_index].iter().collect::<String>();
                let valid_ids = chunk_ids_in_citation(&candidate)
                    .into_iter()
                    .filter(|chunk_id| allowed.contains(chunk_id.as_str()))
                    .collect::<Vec<_>>();
                if !valid_ids.is_empty() || citation_contains_chunk_id_like(&candidate) {
                    for chunk_id in valid_ids {
                        output.push('[');
                        output.push_str(&chunk_id);
                        output.push(']');
                        valid_count += 1;
                    }
                    index = close_index + 1;
                    continue;
                }
            }
        }
        output.push(chars[index]);
        index += 1;
    }
    (output, valid_count)
}

pub(super) fn chunk_ids_in_citation(value: &str) -> Vec<String> {
    value
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | '，' | ';' | '；' | '、' | '|'))
        .map(|part| part.trim_matches(|ch: char| matches!(ch, '[' | ']' | '【' | '】')))
        .filter(|part| is_chunk_id_like(part))
        .map(ToString::to_string)
        .collect()
}

pub(super) fn citation_contains_chunk_id_like(value: &str) -> bool {
    !chunk_ids_in_citation(value).is_empty()
}

pub(super) fn is_chunk_id_like(value: &str) -> bool {
    chunk_id::is_namespaced_chunk_id(value)
}

