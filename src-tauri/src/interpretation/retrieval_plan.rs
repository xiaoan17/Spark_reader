use super::*;

pub(super) fn evidence_queries(request: &InterpretRequest) -> Vec<String> {
    let mut queries = vec![trim_for_query(&request.selection_text, 120)];
    queries.extend(focus_phrase_queries(&request.selection_text));
    queries.extend(query_rewrite_expansions(&request.selection_text));
    if let Some(question) = request
        .question
        .as_deref()
        .filter(|question| !question.trim().is_empty())
    {
        queries.push(trim_for_query(question, 120));
        queries.extend(query_rewrite_expansions(question));
        queries.push(trim_for_query(
            &format!("{} {}", request.selection_text, question),
            180,
        ));
    }
    if let Some(prior_answer) = request
        .prior_answer
        .as_deref()
        .filter(|answer| !answer.trim().is_empty())
    {
        queries.push(trim_for_query(prior_answer, 140));
    }
    for turn in request.follow_up_history.iter().rev().take(3) {
        queries.push(trim_for_query(&turn.question, 100));
        queries.push(trim_for_query(&turn.answer, 120));
    }

    queries.sort();
    queries.dedup();
    queries
        .into_iter()
        .filter(|query| !query.trim().is_empty())
        .collect()
}

pub(super) fn focus_phrase_queries(text: &str) -> Vec<String> {
    let compact = trim_for_query(text, 220);
    let mut queries = compact
        .split(|ch: char| {
            matches!(
                ch,
                '，' | '。' | '；' | '：' | '！' | '？' | ',' | '.' | ';' | ':' | '!' | '?'
            )
        })
        .map(|part| trim_for_query(part, 80))
        .filter(|part| part.chars().count() >= 4)
        .take(4)
        .collect::<Vec<_>>();

    let chars = compact.chars().collect::<Vec<_>>();
    if chars.len() > 80 {
        queries.push(chars.iter().take(60).collect());
        queries.push(
            chars
                .iter()
                .rev()
                .take(60)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
        );
    }
    queries
}

pub(super) fn query_rewrite_expansions(text: &str) -> Vec<String> {
    query_rewrite_expansions_with_pairs(text, &configurable_concept_pairs())
}

pub(super) fn query_rewrite_expansions_with_pairs(
    text: &str,
    concept_pairs: &[(String, String)],
) -> Vec<String> {
    let mut expansions = Vec::new();
    let terms = lexical_terms(text);
    let chinese_terms = terms
        .iter()
        .filter(|term| contains_cjk(term) && term.chars().count() >= 2)
        .take(10)
        .cloned()
        .collect::<Vec<_>>();
    if !chinese_terms.is_empty() {
        expansions.push(chinese_terms.join(" "));
    }
    let compact_cjk = compact_cjk_text(text);
    if compact_cjk.chars().count() >= 4 {
        let topic_terms = cjk_topic_terms(&compact_cjk);
        if !topic_terms.is_empty() {
            expansions.push(topic_terms.join(" "));
        }
    }

    let compact = trim_for_query(text, 180);
    for (needle, rewrite) in concept_pairs {
        if compact.contains(needle.as_str()) {
            expansions.push(format!("{needle} {rewrite}"));
        }
    }
    expansions
}

pub(super) struct RetrievalPlan {
    pub(super) note: String,
    pub(super) queries: Vec<String>,
}

pub(super) fn build_retrieval_plan(request: &InterpretRequest) -> RetrievalPlan {
    let mut queries = evidence_queries(request);
    match request.mode {
        InterpretMode::Deep => {
            queries.push(trim_for_query(
                &format!("定义 背景 上下文 {}", request.selection_text),
                160,
            ));
            queries.push(trim_for_query(
                &format!("呼应 对照 结论 {}", request.selection_text),
                160,
            ));
        }
        InterpretMode::Plain => {
            queries.push(trim_for_query(
                &format!("上下文 {}", request.selection_text),
                140,
            ));
        }
        InterpretMode::Apply => {
            queries.push(trim_for_query(
                &format!("原则 方法 迁移 应用 场景 {}", request.selection_text),
                180,
            ));
            queries.push(trim_for_query(
                &format!("限制 条件 反例 风险 {}", request.selection_text),
                180,
            ));
        }
    }
    queries.sort();
    queries.dedup();
    queries.retain(|query| !query.trim().is_empty());

    RetrievalPlan {
        note: format!(
            "Plan: 以框选文本为焦点，生成 {} 条检索查询；每轮都回到原文，不做泛化总结。",
            queries.len()
        ),
        queries,
    }
}

pub(super) fn insert_hit(by_id: &mut BTreeMap<String, EvidenceItem>, hit: storage::SearchHit) {
    by_id.entry(hit.chunk_id.clone()).or_insert(EvidenceItem {
        title: format!("Chunk {}", hit.chunk_id),
        chunk_id: hit.chunk_id,
        page_index: hit.page_index,
        text: hit.text,
        score: hit.score,
        rects: hit.rects,
    });
}

pub(super) fn rank_evidence(mut evidence: Vec<EvidenceItem>, request: &InterpretRequest) -> Vec<EvidenceItem> {
    let page_indexes = &request.page_indexes;
    let terms = ranking_terms(request);
    let focus_rank = request
        .focus_chunk_ids
        .iter()
        .enumerate()
        .map(|(index, chunk_id)| (chunk_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let prior_rank = request
        .prior_evidence_chunk_ids
        .iter()
        .enumerate()
        .map(|(index, chunk_id)| (chunk_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    evidence.sort_by(|a, b| {
        let a_focus = focus_rank.get(a.chunk_id.as_str()).copied();
        let b_focus = focus_rank.get(b.chunk_id.as_str()).copied();
        let a_prior = prior_rank.get(a.chunk_id.as_str()).copied();
        let b_prior = prior_rank.get(b.chunk_id.as_str()).copied();
        let a_same_page = page_indexes.contains(&a.page_index);
        let b_same_page = page_indexes.contains(&b.page_index);
        let a_geometry = selection_rect_score(a, &request.selection_rects);
        let b_geometry = selection_rect_score(b, &request.selection_rects);
        let a_overlap = lexical_match_score(&a.text, &terms);
        let b_overlap = lexical_match_score(&b.text, &terms);
        let score_order = b
            .score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal);
        a_focus
            .is_none()
            .cmp(&b_focus.is_none())
            .then_with(|| {
                a_focus
                    .unwrap_or(usize::MAX)
                    .cmp(&b_focus.unwrap_or(usize::MAX))
            })
            .then_with(|| b_same_page.cmp(&a_same_page))
            .then_with(|| b_geometry.cmp(&a_geometry))
            .then_with(|| a_prior.is_none().cmp(&b_prior.is_none()))
            .then_with(|| {
                a_prior
                    .unwrap_or(usize::MAX)
                    .cmp(&b_prior.unwrap_or(usize::MAX))
            })
            .then(score_order)
            .then_with(|| b_overlap.cmp(&a_overlap))
            .then_with(|| a.page_index.cmp(&b.page_index))
            .then_with(|| a.chunk_id.cmp(&b.chunk_id))
    });
    evidence
}

pub(super) fn selection_rect_score(
    evidence: &EvidenceItem,
    selection_rects: &[storage::NormalizedRectInput],
) -> u32 {
    if selection_rects.is_empty() || evidence.rects.is_empty() {
        return 0;
    }
    let mut score = 0.0;
    for selection_rect in selection_rects {
        for evidence_rect in &evidence.rects {
            if selection_rect.page_index != evidence_rect.page_index
                || evidence.page_index != evidence_rect.page_index
            {
                continue;
            }
            score += rect_intersection_area(selection_rect, evidence_rect);
        }
    }
    (score * 1_000_000.0).round() as u32
}

pub(super) fn rect_intersection_area(
    left: &storage::NormalizedRectInput,
    right: &storage::NormalizedRectInput,
) -> f64 {
    let width = (left.x1.min(right.x1) - left.x0.max(right.x0)).max(0.0);
    let height = (left.y1.min(right.y1) - left.y0.max(right.y0)).max(0.0);
    width * height
}

pub(super) fn ranking_terms(request: &InterpretRequest) -> Vec<String> {
    let mut terms = lexical_terms(&request.selection_text);
    if let Some(question) = &request.question {
        terms.extend(lexical_terms(question));
    }
    terms.sort();
    terms.dedup();
    terms
}

pub(super) fn lexical_terms(text: &str) -> Vec<String> {
    let compact = text
        .to_lowercase()
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>();
    let mut terms = compact
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let chars = compact
        .chars()
        .filter(|ch| !ch.is_whitespace() && !is_punctuation(*ch))
        .collect::<Vec<_>>();
    for window in chars.windows(2).take(80) {
        terms.push(window.iter().collect());
    }
    for window in chars.windows(3).take(80) {
        terms.push(window.iter().collect());
    }
    if contains_cjk(&compact) {
        terms.extend(cjk_topic_terms(&compact));
    }
    terms
}

pub(super) fn cjk_topic_terms(text: &str) -> Vec<String> {
    let chars = compact_cjk_text(text).chars().collect::<Vec<_>>();
    if chars.len() < 2 {
        return Vec::new();
    }
    let mut scores = BTreeMap::<String, usize>::new();
    for size in [2, 3, 4] {
        for window in chars.windows(size).take(120) {
            if window.iter().all(|ch| cjk_stop_char(*ch)) {
                continue;
            }
            let term = window.iter().collect::<String>();
            *scores.entry(term).or_insert(0) += size;
        }
    }
    let mut ranked = scores.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|(left_term, left_score), (right_term, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| right_term.chars().count().cmp(&left_term.chars().count()))
            .then_with(|| left_term.cmp(right_term))
    });
    ranked.into_iter().map(|(term, _)| term).take(24).collect()
}

pub(super) fn compact_cjk_text(text: &str) -> String {
    text.chars()
        .filter(|ch| contains_cjk_char(*ch))
        .collect::<String>()
}

pub(super) fn contains_cjk_char(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
        || ('\u{3400}'..='\u{4dbf}').contains(&ch)
        || ('\u{f900}'..='\u{faff}').contains(&ch)
}

pub(super) fn cjk_stop_char(ch: char) -> bool {
    matches!(
        ch,
        '的' | '了'
            | '和'
            | '与'
            | '及'
            | '或'
            | '在'
            | '是'
            | '有'
            | '为'
            | '对'
            | '中'
            | '上'
            | '下'
            | '这'
            | '那'
            | '把'
            | '被'
            | '而'
            | '并'
            | '就'
            | '都'
            | '也'
            | '更'
            | '从'
            | '到'
    )
}

pub(super) fn contains_cjk(text: &str) -> bool {
    text.chars().any(contains_cjk_char)
}

pub(super) fn lexical_match_score(text: &str, terms: &[String]) -> usize {
    if terms.is_empty() {
        return 0;
    }
    let haystack = text.to_lowercase();
    terms
        .iter()
        .filter(|term| !term.trim().is_empty() && haystack.contains(term.as_str()))
        .map(|term| term.chars().count().clamp(1, 8))
        .sum()
}

pub(super) fn configurable_concept_pairs() -> Vec<(String, String)> {
    #[cfg(not(test))]
    crate::config::load_dotenv();
    if let Ok(raw) = env::var("FOCUSED_READING_CONCEPT_PAIRS") {
        return parse_concept_pairs(&raw);
    }
    default_concept_pairs()
        .into_iter()
        .map(|(needle, rewrite)| (needle.to_string(), rewrite.to_string()))
        .collect()
}

pub(super) fn parse_concept_pairs(raw: &str) -> Vec<(String, String)> {
    raw.split(';')
        .filter_map(|entry| {
            let (needle, rewrite) = entry.split_once('=')?;
            let needle = needle.trim();
            let rewrite = rewrite.trim();
            (!needle.is_empty() && !rewrite.is_empty())
                .then(|| (needle.to_string(), rewrite.to_string()))
        })
        .collect()
}

pub(super) fn default_concept_pairs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("复利", "长期 时间 耐心 增长"),
        ("风险", "波动 控制 安全边际"),
        ("现金流", "流动性 持续 投入"),
        ("认知", "理解 判断 决策"),
        ("模型", "框架 机制 结构"),
        ("历史", "背景 演变 原因"),
        ("市场", "价格 竞争 供需"),
        ("制度", "规则 激励 约束"),
        ("技术", "工具 系统 效率"),
        ("学习", "反馈 迁移 练习"),
        ("组织", "协作 流程 治理"),
        ("数据", "指标 样本 趋势"),
    ]
}

pub(super) fn is_punctuation(ch: char) -> bool {
    matches!(
        ch,
        '，' | '。'
            | '；'
            | '：'
            | '！'
            | '？'
            | '、'
            | ','
            | '.'
            | ';'
            | ':'
            | '!'
            | '?'
            | '"'
            | '\''
            | '“'
            | '”'
            | '‘'
            | '’'
            | '('
            | ')'
            | '（'
            | '）'
            | '['
            | ']'
    )
}
