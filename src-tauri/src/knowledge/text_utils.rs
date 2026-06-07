//! Text/string utilities for knowledge candidate & event extraction.
//! Split out of knowledge/mod.rs (P10 architecture refactor).
//! Mostly pure functions over `&str`; a few call back into the parent
//! module (e.g. `summary_from_text`), hence the `use super::*` glob.

use super::*;

pub(super) fn extract_book_titles(text: &str) -> Vec<String> {
    let chars = text.chars().collect::<Vec<_>>();
    let mut terms = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '《' {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < chars.len() && chars[end] != '》' {
            end += 1;
        }
        if end < chars.len() {
            let term = chars[start..end].iter().collect::<String>();
            terms.push(term);
            index = end + 1;
        } else {
            break;
        }
    }
    terms
}

pub(super) fn extract_english_terms(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    for ch in text.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_alphanumeric()
            || ch == '-'
            || ch == '_'
            || (ch == ' ' && !current.is_empty())
        {
            current.push(ch);
            continue;
        }
        push_english_term(&mut terms, &current);
        current.clear();
    }
    terms
}

pub(super) fn push_english_term(terms: &mut Vec<String>, value: &str) {
    let cleaned = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|ch: char| !ch.is_ascii_alphanumeric())
        .to_string();
    if cleaned.len() < 2 {
        return;
    }
    let words = cleaned.split_whitespace().collect::<Vec<_>>();
    for title_case_term in extract_title_case_terms(&words) {
        terms.push(title_case_term);
    }
    if cleaned.len() > 42 {
        return;
    }
    let has_acronym = words.iter().any(|word| {
        word.len() >= 2
            && word
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
    });
    let has_title_case_pair = words.len() >= 2
        && words.iter().take(4).all(|word| {
            word.chars()
                .next()
                .map(|ch| ch.is_ascii_uppercase())
                .unwrap_or(false)
        });
    if has_acronym || has_title_case_pair {
        terms.push(cleaned);
    }
}

pub(super) fn extract_title_case_terms(words: &[&str]) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = Vec::<String>::new();
    let mut significant_count = 0;
    for word in words {
        let cleaned = word.trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-');
        if cleaned.is_empty() {
            flush_title_case_term(&mut terms, &mut current, &mut significant_count);
            continue;
        }
        if is_title_case_word(cleaned) {
            current.push(cleaned.to_string());
            significant_count += 1;
        } else if is_english_connector(cleaned) && significant_count > 0 {
            current.push(cleaned.to_string());
        } else {
            flush_title_case_term(&mut terms, &mut current, &mut significant_count);
        }
    }
    flush_title_case_term(&mut terms, &mut current, &mut significant_count);
    terms
}

pub(super) fn flush_title_case_term(
    terms: &mut Vec<String>,
    current: &mut Vec<String>,
    significant_count: &mut usize,
) {
    while current
        .first()
        .is_some_and(|word| is_english_connector(word))
    {
        current.remove(0);
    }
    while current
        .last()
        .is_some_and(|word| is_english_connector(word))
    {
        current.pop();
    }
    if *significant_count >= 2 {
        let term = current.join(" ");
        if (2..=64).contains(&term.len()) {
            terms.push(term);
        }
    }
    current.clear();
    *significant_count = 0;
}

pub(super) fn is_title_case_word(word: &str) -> bool {
    if word.len() >= 2
        && word
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '-')
    {
        return true;
    }
    word.chars()
        .next()
        .map(|ch| ch.is_ascii_uppercase())
        .unwrap_or(false)
        && word.chars().skip(1).any(|ch| ch.is_ascii_lowercase())
}

pub(super) fn is_english_connector(word: &str) -> bool {
    matches!(
        word.to_ascii_lowercase().as_str(),
        "and" | "or" | "of" | "the" | "in" | "for" | "to" | "with" | "on"
    )
}

pub(super) fn extract_cjk_terms(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    for segment in split_candidate_segments(text) {
        let cleaned = clean_candidate_title(&segment);
        if cjk_char_count(&cleaned) >= 2 && cjk_char_count(&cleaned) <= 8 {
            terms.push(cleaned);
        } else if cjk_char_count(&cleaned) > 8 {
            for sub_segment in split_long_cjk_segment(&cleaned) {
                if cjk_char_count(&sub_segment) >= 2 && cjk_char_count(&sub_segment) <= 8 {
                    terms.push(sub_segment);
                }
            }
        }
    }
    terms
}

pub(super) fn split_candidate_segments(text: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if is_hard_separator(ch) {
            push_segment(&mut segments, &current);
            current.clear();
        } else {
            current.push(ch);
        }
    }
    push_segment(&mut segments, &current);
    segments
}

pub(super) fn split_long_cjk_segment(value: &str) -> Vec<String> {
    let particles = [
        "来自", "导致", "因为", "所以", "作者", "强调", "认为", "提出", "说明", "证明", "支持",
        "对比", "区别", "以及", "同时", "通过", "关于", "之间", "成为", "建立", "发生",
    ];
    let mut segments = vec![value.to_string()];
    for particle in particles {
        segments = segments
            .into_iter()
            .flat_map(|segment| {
                segment
                    .split(particle)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .collect();
    }
    segments
        .into_iter()
        .map(|segment| clean_candidate_title(&segment))
        .filter(|segment| !segment.is_empty())
        .collect()
}

pub(super) fn push_segment(segments: &mut Vec<String>, value: &str) {
    let cleaned = clean_candidate_title(value);
    if !cleaned.is_empty() {
        segments.push(cleaned);
    }
}

pub(super) fn extract_event_sentences(text: &str) -> Vec<String> {
    split_sentences(text)
        .into_iter()
        .map(|sentence| summary_from_text(&sentence, 96))
        .filter(|sentence| {
            let cjk_count = cjk_char_count(sentence);
            (8..=90).contains(&cjk_count) && looks_like_event_sentence(sentence)
        })
        .take(16)
        .collect()
}

pub(super) fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '；' | '\n' | '.' | '!' | '?' | ';') {
            push_segment(&mut sentences, &current);
            current.clear();
        }
    }
    push_segment(&mut sentences, &current);
    sentences
}

pub(super) fn looks_like_event_sentence(sentence: &str) -> bool {
    let event_markers = [
        "发生", "提出", "导致", "成为", "建立", "发布", "证明", "发现", "开始", "结束", "改变",
        "形成", "出现", "引发", "完成", "创立", "进入", "推出",
    ];
    event_markers.iter().any(|marker| sentence.contains(marker)) || contains_date_marker(sentence)
}

pub(super) fn contains_date_marker(value: &str) -> bool {
    value.contains('年')
        || value.contains('月')
        || value.contains('日')
        || value
            .split(|ch: char| !ch.is_ascii_digit())
            .any(|token| token.len() == 4 && token.parse::<u32>().is_ok())
}

pub(super) fn relation_types_for_text(text: &str) -> BTreeSet<String> {
    let mut relations = BTreeSet::new();
    if contains_any(
        text,
        &["支持", "证明", "依据", "表明", "说明", "强调", "印证"],
    ) {
        relations.insert("supports".to_string());
    }
    if contains_any(
        text,
        &[
            "对比", "相反", "不同", "冲突", "反驳", "区别", "不是", "矛盾",
        ],
    ) {
        relations.insert("contrasts".to_string());
    }
    if contains_any(
        text,
        &[
            "导致", "因为", "原因", "所以", "因果", "造成", "引发", "源于", "来自",
        ],
    ) {
        relations.insert("causes".to_string());
    }
    relations
}

pub(super) fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

pub(super) fn card_type_for_term(title: &str, kind: &str, context: &str) -> String {
    if kind == "work" {
        return "entity".to_string();
    }
    if context.contains(&format!("{title}发生"))
        || context.contains(&format!("{title}提出"))
        || context.contains(&format!("{title}建立"))
    {
        return "event".to_string();
    }
    if looks_like_named_entity(title) {
        "entity".to_string()
    } else {
        "concept".to_string()
    }
}

pub(super) fn looks_like_named_entity(title: &str) -> bool {
    title.ends_with('国')
        || title.ends_with('市')
        || title.ends_with('省')
        || title.ends_with("公司")
        || title.ends_with("大学")
        || title.ends_with("机构")
        || title.ends_with("组织")
        || title.contains('·')
}

pub(super) fn snippet_for_term(text: &str, title: &str) -> String {
    if let Some(byte_index) = text.find(title) {
        let before = text[..byte_index]
            .chars()
            .rev()
            .take(36)
            .collect::<Vec<_>>();
        let before = before.into_iter().rev().collect::<String>();
        let after_start = byte_index + title.len();
        let after = text[after_start..].chars().take(72).collect::<String>();
        format!("{before}{title}{after}")
    } else {
        summary_from_text(text, 120)
    }
}

pub(super) fn clean_candidate_title(value: &str) -> String {
    let stripped = value
        .replace(
            [
                '#', '*', '`', '>', '[', ']', '(', ')', '{', '}', '"', '\'', '\r',
            ],
            "",
        )
        .replace(['，', '。', '；', '：', '、', ',', ';', ':'], " ");
    stripped
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|ch: char| {
            ch.is_whitespace()
                || matches!(
                    ch,
                    '-' | '_' | '“' | '”' | '‘' | '’' | '《' | '》' | '<' | '>' | '/' | '\\'
                )
        })
        .to_string()
}

pub(super) fn normalize_candidate_title(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_whitespace() && !matches!(ch, '《' | '》' | '"' | '\'' | '`'))
        .flat_map(char::to_lowercase)
        .collect()
}

pub(super) fn is_valid_candidate_title(title: &str, normalized: &str) -> bool {
    if normalized.is_empty() || normalized.chars().count() < 2 || normalized.chars().count() > 64 {
        return false;
    }
    if KNOWLEDGE_STOPWORDS.contains(&normalized) {
        return false;
    }
    if title.chars().all(|ch| ch.is_ascii_digit()) {
        return false;
    }
    let cjk_count = cjk_char_count(title);
    if cjk_count > 0 {
        return (2..=12).contains(&cjk_count);
    }
    true
}

pub(super) fn cjk_char_count(value: &str) -> usize {
    value.chars().filter(|ch| is_cjk_char(*ch)).count()
}

pub(super) fn is_cjk_char(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
}

pub(super) fn is_hard_separator(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            '，' | '。'
                | '；'
                | '：'
                | '、'
                | '！'
                | '？'
                | ','
                | '.'
                | ';'
                | ':'
                | '!'
                | '?'
                | '\n'
                | '\t'
                | '|'
                | '/'
                | '\\'
        )
}
