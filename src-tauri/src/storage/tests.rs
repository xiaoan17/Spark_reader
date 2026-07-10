//! Tests for the storage module. Split out of storage/mod.rs (P10).
//! Declared via `#[cfg(test)] mod tests;` in mod.rs.

use super::*;
use std::{
    io::{BufRead, BufReader, Write as _},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

fn disable_embedding_provider() {
    isolate_provider_config("disabled");
    std::env::set_var("EMBEDDING_PROVIDER", "disabled");
}

fn isolate_provider_config(name: &str) -> PathBuf {
    let worker = std::env::var("RUST_TEST_THREAD").unwrap_or_else(|_| "main".to_string());
    let thread_id = format!("{:?}", std::thread::current().id())
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let dir = std::env::temp_dir().join(format!(
        "focused-reading-storage-config-{}-{}-{}-{}",
        name,
        std::process::id(),
        worker,
        thread_id
    ));
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::create_dir_all(&dir);
    std::env::set_var("FOCUSED_READING_CONFIG_DIR", &dir);
    std::env::set_var("FOCUSED_READING_ENV_PATH", dir.join(".env"));
    dir
}

fn clear_embedding_env() {
    std::env::remove_var("EMBEDDING_API_KEY");
    std::env::remove_var("EMBEDDING_BASE_URL");
    std::env::remove_var("EMBEDDING_MODEL");
    std::env::remove_var("EMBEDDING_DIM");
    std::env::remove_var("EMBEDDING_EXPECTED_DIM");
}

fn temp_db(name: &str) -> PathBuf {
    disable_embedding_provider();
    let worker = std::env::var("RUST_TEST_THREAD").unwrap_or_else(|_| "main".to_string());
    let thread_id = format!("{:?}", std::thread::current().id())
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!(
        "focused-reading-storage-{}-{}-{}-{}",
        name,
        std::process::id(),
        worker,
        thread_id
    ));
    let _ = fs::create_dir_all(&dir);
    dir.join(format!("{nonce}.sqlite3"))
}

#[test]
fn saves_book_and_searches_chunks() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    disable_embedding_provider();
    let path = temp_db("search");
    let _ = fs::remove_file(&path);
    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "测试书".to_string(),
            total_pages: 2,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 12,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![
                ParsedPageInput {
                    page_index: 0,
                    text: "复利来自时间和耐心。".to_string(),
                    markdown: "## Page 1\n\n复利来自时间和耐心。".to_string(),
                },
                ParsedPageInput {
                    page_index: 1,
                    text: "风险控制决定长期收益。".to_string(),
                    markdown: "## Page 2\n\n风险控制决定长期收益。".to_string(),
                },
            ],
            chunks: vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "复利来自时间和耐心。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n复利来自时间和耐心。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "p2-c1".to_string(),
                    page_index: 1,
                    text: "风险控制决定长期收益。".to_string(),
                    markdown: "### [p2-c1] Page 2\n\n风险控制决定长期收益。".to_string(),
                    rects: vec![NormalizedRectInput {
                        page_index: 1,
                        x0: 0.1,
                        y0: 0.2,
                        x1: 0.8,
                        y1: 0.3,
                    }],
                    coordinate_version: COORDINATE_VERSION,
                },
            ],
        },
    )
    .expect("book should save");

    assert_eq!(saved.page_count, 2);
    assert_eq!(saved.chunk_count, 2);
    assert!(saved.text_char_count > 0);
    assert!(saved.markdown_char_count > saved.text_char_count);
    let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
    assert_eq!(summary.embedding_model, "");
    assert_eq!(summary.embedding_dim, 0);
    assert!(!summary.embedding_enabled);
    assert!(!summary.embedding_matches_config);
    assert_eq!(summary.chunk_count, 2);
    assert_eq!(summary.vector_count, 0);
    assert!(summary.fts_ready);

    let hits = hybrid_search_book(&path, &saved.book_id, "风险", 5).expect("search should work");
    assert_eq!(hits.len(), 1);
    assert!(chunk_id::is_namespaced_chunk_id(&hits[0].chunk_id));
    assert!(hits[0].chunk_id.contains("-p2-c1-"));
    assert_eq!(hits[0].page_index, 1);
    assert_eq!(hits[0].coordinate_version, COORDINATE_VERSION);
    assert_eq!(hits[0].rects.len(), 1);
    assert_eq!(hits[0].rects[0].x0, 0.1);
    let cjk_hits = hybrid_search_book(&path, &saved.book_id, "风险控制决定", 5)
        .expect("continuous CJK query should fall back to lexical windows");
    assert_eq!(cjk_hits.len(), 1);
    assert!(cjk_hits[0].chunk_id.contains("-p2-c1-"));
    let asset = get_converted_book(&path, &saved.book_id).expect("asset should load");
    assert!(asset.text.contains("复利来自时间和耐心"));
    assert!(asset.markdown.contains("## Page 1"));
    assert_eq!(asset.pages.len(), 2);
    assert_eq!(asset.chunks.len(), 2);
    assert_eq!(asset.chunks[1].coordinate_version, COORDINATE_VERSION);
    assert_eq!(asset.chunks[1].rects.len(), 1);
    assert_eq!(asset.parser_engine, "test");
    assert_eq!(asset.coordinate_mode, "text-only");
    assert!(asset
        .quality
        .as_ref()
        .is_some_and(|quality| quality.looks_usable));
    assert!(Path::new(&saved.text_path).exists());
    assert!(Path::new(&saved.markdown_path).exists());
    assert!(Path::new(&asset.text_path).exists());
    assert!(Path::new(&asset.markdown_path).exists());
    for index_name in [
        "idx_chunks_book_page_id",
        "idx_chunk_embeddings_book_provider_model",
        "idx_highlights_book_page_created",
        "idx_interpretations_book_session_turn",
    ] {
        assert!(
            sqlite_index_exists(&path, index_name),
            "{index_name} should exist"
        );
    }
    let manifest =
        get_converted_book_manifest(&path, &saved.book_id).expect("manifest should load");
    assert_eq!(manifest.book_id, saved.book_id);
    assert_eq!(manifest.total_pages, 2);
    assert_eq!(manifest.chunk_count, 2);
    assert_eq!(manifest.text_char_count, saved.text_char_count as u32);
    let window =
        get_converted_book_pages(&path, &saved.book_id, 1, 1).expect("page window should load");
    assert_eq!(window.start_page, 1);
    assert_eq!(window.end_page, 2);
    assert_eq!(window.total_pages, 2);
    assert_eq!(window.pages.len(), 1);
    assert_eq!(window.pages[0].page_index, 1);
    assert_eq!(window.chunks.len(), 1);
    assert!(window.text.contains("风险控制决定长期收益"));
    assert!(!window.text.contains("复利来自时间和耐心"));
    let _ = fs::remove_file(&path);
}

#[test]
fn rewrites_mineru_markdown_and_html_image_assets() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("mineru-assets");
    let _ = fs::remove_file(&path);
    let source_root = std::env::temp_dir().join(format!(
        "focused-reading-mineru-assets-{}",
        std::process::id()
    ));
    let batch_a = source_root.join("batch-a");
    let batch_b = source_root.join("batch-b");
    let _ = fs::remove_dir_all(&source_root);
    fs::create_dir_all(batch_a.join("images")).expect("batch a images should create");
    fs::create_dir_all(batch_b.join("images")).expect("batch b images should create");
    fs::write(batch_a.join("images/chart one.png"), b"chart").expect("chart image should write");
    fs::write(batch_b.join("images/table cell.png"), b"table").expect("table image should write");

    let saved = save_book(
            &path,
            SaveBookRequest {
                title: "MinerU 图片资源测试".to_string(),
                total_pages: 1,
                parser_engine: "mineru-content-list-batched".to_string(),
                coordinate_mode: "text-only".to_string(),
                quality: None,
                source_pdf_path: None,
                source_asset_dir: None,
                source_asset_dirs: vec![
                    batch_a.to_string_lossy().to_string(),
                    batch_b.to_string_lossy().to_string(),
                ],
                pages: vec![ParsedPageInput {
                    page_index: 0,
                    text: "图表页".to_string(),
                    markdown: "![chart](batch-a/images/chart one.png)\n\n<table><tr><td rowspan=\"2\"><img src=\"batch-b/images/table cell.png\"/></td></tr></table>\n\n[外链](https://example.com)".to_string(),
                }],
                chunks: vec![ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "图表页".to_string(),
                    markdown: "![chart](batch-a/images/chart one.png)\n\n<table><tr><td><img src=\"batch-b/images/table cell.png\"/></td></tr></table>".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                }],
            },
        )
        .expect("book should save");

    let asset_dir = converted_book_asset_dir(&path, &saved.book_id);
    assert!(asset_dir.join("batch-a/images/chart one.png").exists());
    assert!(asset_dir.join("batch-b/images/table cell.png").exists());
    let asset = get_converted_book(&path, &saved.book_id).expect("asset should load");
    assert!(asset.markdown.contains("file://"));
    assert!(asset.markdown.contains("chart%20one.png"));
    assert!(asset.markdown.contains("table%20cell.png"));
    assert!(asset.markdown.contains("<td rowspan=\"2\">"));
    assert!(asset.markdown.contains("[外链](https://example.com)"));
    assert!(!asset.markdown.contains("batch-a/images/chart one.png"));
    assert!(!asset.markdown.contains("batch-b/images/table cell.png"));

    let _ = fs::remove_dir_all(&source_root);
    let _ = fs::remove_dir_all(asset_dir);
    let _ = fs::remove_file(&path);
}

fn sqlite_index_exists(path: &Path, index_name: &str) -> bool {
    let conn = open_database(path).expect("database should open");
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1",
        params![index_name],
        |_| Ok(true),
    )
    .optional()
    .expect("index lookup should run")
    .unwrap_or(false)
}

#[test]
fn hybrid_search_works_without_embedding_provider_and_rebuilds_text_index() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    disable_embedding_provider();
    let path = temp_db("hybrid-no-embedding");
    let _ = fs::remove_file(&path);
    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "混合检索测试".to_string(),
            total_pages: 2,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 18,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![
                ParsedPageInput {
                    page_index: 0,
                    text: "资产配置需要分散风险。".to_string(),
                    markdown: "## Page 1\n\n资产配置需要分散风险。".to_string(),
                },
                ParsedPageInput {
                    page_index: 1,
                    text: "长期主义依赖耐心和现金流。".to_string(),
                    markdown: "## Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                },
            ],
            chunks: vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "资产配置需要分散风险。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n资产配置需要分散风险。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "p2-c1".to_string(),
                    page_index: 1,
                    text: "长期主义依赖耐心和现金流。".to_string(),
                    markdown: "### [p2-c1] Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
            ],
        },
    )
    .expect("book should save");

    let text_hits =
        hybrid_search_book(&path, &saved.book_id, "现金", 3).expect("hybrid search should work");
    assert!(chunk_id::is_namespaced_chunk_id(&text_hits[0].chunk_id));
    assert!(text_hits[0].chunk_id.contains("-p2-c1-"));

    let rebuilt = rebuild_search_index(&path, &saved.book_id).expect("index should rebuild");
    assert_eq!(rebuilt.vector_count, 0);
    assert_eq!(rebuilt.embedding_model, "");
    assert_eq!(rebuilt.embedding_dim, 0);
    assert!(!rebuilt.embedding_enabled);
    assert!(!rebuilt.embedding_matches_config);
    assert!(rebuilt.fts_ready);
    let _ = fs::remove_file(&path);
}

#[test]
fn hybrid_search_uses_matching_provider_embeddings_for_vector_recall() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    isolate_provider_config("vector-provider");
    clear_embedding_env();
    let server = FakeEmbeddingServer::start();
    std::env::set_var("EMBEDDING_PROVIDER", "test-provider");
    std::env::set_var("EMBEDDING_API_KEY", "embedding-test-key");
    std::env::set_var("EMBEDDING_BASE_URL", server.embeddings_url());
    std::env::set_var("EMBEDDING_MODEL", "test-embedding-model");
    std::env::set_var("EMBEDDING_DIM", "3");
    let path = std::env::temp_dir().join(format!(
        "focused-reading-storage-vector-provider-{}.sqlite3",
        std::process::id()
    ));
    let _ = fs::remove_file(&path);

    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "向量检索测试".to_string(),
            total_pages: 2,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 20,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![
                ParsedPageInput {
                    page_index: 0,
                    text: "资产配置需要分散风险。".to_string(),
                    markdown: "## Page 1\n\n资产配置需要分散风险。".to_string(),
                },
                ParsedPageInput {
                    page_index: 1,
                    text: "长期主义依赖耐心和现金流。".to_string(),
                    markdown: "## Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                },
            ],
            chunks: vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "资产配置需要分散风险。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n资产配置需要分散风险。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "p2-c1".to_string(),
                    page_index: 1,
                    text: "长期主义依赖耐心和现金流。".to_string(),
                    markdown: "### [p2-c1] Page 2\n\n长期主义依赖耐心和现金流。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
            ],
        },
    )
    .expect("book should save and build provider embeddings");

    let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
    assert_eq!(summary.chunk_count, 2);
    assert_eq!(summary.vector_count, 2);
    assert_eq!(summary.embedding_provider, "test-provider");
    assert_eq!(summary.embedding_base_url, server.embeddings_url());
    assert_eq!(summary.embedding_model, "test-embedding-model");
    assert_eq!(summary.embedding_dim, 3);
    assert!(summary.embedding_enabled);
    assert!(summary.embedding_key_configured);
    assert!(summary.embedding_matches_config);

    let vector_hits = hybrid_search_book(&path, &saved.book_id, "semantic-allocation", 3)
        .expect("vector search should work");
    assert_eq!(vector_hits.len(), 1);
    assert!(chunk_id::is_namespaced_chunk_id(&vector_hits[0].chunk_id));
    assert!(vector_hits[0].chunk_id.contains("-p1-c1-"));
    assert_eq!(vector_hits[0].page_index, 0);

    std::env::set_var("EMBEDDING_MODEL", "different-embedding-model");
    let stale_summary = search_index_summary(&path, &saved.book_id).expect("index summary");
    assert!(
        !stale_summary.embedding_matches_config,
        "changing embedding model must force a rebuild before old vectors can be trusted"
    );
    let stale_hits = hybrid_search_book(&path, &saved.book_id, "semantic-allocation", 3)
        .expect("hybrid search should not use stale vectors");
    assert!(
        stale_hits.is_empty(),
        "provider/model mismatches must not silently mix stale embedding vectors"
    );

    let _ = fs::remove_file(&path);
    disable_embedding_provider();
    std::env::remove_var("EMBEDDING_API_KEY");
    std::env::remove_var("EMBEDDING_BASE_URL");
    std::env::remove_var("EMBEDDING_MODEL");
    std::env::remove_var("EMBEDDING_DIM");
}

#[test]
fn legacy_embedding_rows_are_marked_as_rebuild_required() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    disable_embedding_provider();
    clear_embedding_env();
    let path = temp_db("legacy-embedding-metadata");
    let _ = fs::remove_file(&path);
    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "旧向量元数据测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "旧向量不能混用。".to_string(),
                markdown: "## Page 1\n\n旧向量不能混用。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "旧向量不能混用。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n旧向量不能混用。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");
    let saved_chunk_id = get_chunk(&path, &saved.book_id, "p1-c1")
        .expect("legacy chunk alias should resolve")
        .expect("saved chunk should exist")
        .chunk_id;

    let conn = open_database(&path).expect("database should open");
    conn.execute(
            "INSERT INTO embedding_indexes(book_id, provider, base_url, model, dimension, last_error, created_at)
             VALUES (?1, '', '', ?2, ?3, '', datetime('now'))",
            params![saved.book_id, "Qwen/Qwen3-Embedding-4B", 2560_u32],
        )
        .expect("legacy metadata should insert");
    conn.execute(
            "INSERT INTO chunk_embeddings(book_id, chunk_id, provider, base_url, model, dimension, embedding_json)
             VALUES (?1, ?2, '', '', ?3, ?4, ?5)",
            params![
                saved.book_id,
                saved_chunk_id,
                "Qwen/Qwen3-Embedding-4B",
                2560_u32,
                serde_json::to_string(&vec![1.0_f32; 2560]).expect("embedding JSON")
            ],
        )
        .expect("legacy embedding should insert");
    drop(conn);

    std::env::set_var("EMBEDDING_PROVIDER", "siliconflow");
    std::env::set_var("EMBEDDING_API_KEY", "configured-key");
    std::env::set_var(
        "EMBEDDING_BASE_URL",
        "https://api.siliconflow.cn/v1/embeddings",
    );
    std::env::set_var("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B");
    std::env::set_var("EMBEDDING_DIM", "2560");
    let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
    assert_eq!(summary.vector_count, 1);
    assert!(summary.embedding_enabled);
    assert!(summary.embedding_key_configured);
    assert_eq!(summary.embedding_provider, "");
    assert_eq!(summary.embedding_model, "Qwen/Qwen3-Embedding-4B");
    assert_eq!(summary.embedding_dim, 2560);
    assert!(
        !summary.embedding_matches_config,
        "vectors without provider/base URL metadata must be rebuilt before use"
    );

    let _ = fs::remove_file(&path);
    disable_embedding_provider();
    std::env::remove_var("EMBEDDING_API_KEY");
    std::env::remove_var("EMBEDDING_BASE_URL");
    std::env::remove_var("EMBEDDING_MODEL");
    std::env::remove_var("EMBEDDING_DIM");
}

#[test]
fn save_book_keeps_text_index_when_embedding_provider_fails() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    isolate_provider_config("embedding-failure");
    clear_embedding_env();
    std::env::set_var("EMBEDDING_PROVIDER", "siliconflow");
    std::env::set_var("EMBEDDING_API_KEY", "invalid-key");
    std::env::set_var("EMBEDDING_BASE_URL", "http://127.0.0.1:1/v1/embeddings");
    std::env::set_var("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B");
    std::env::set_var("EMBEDDING_DIM", "2560");
    let path = std::env::temp_dir().join(format!(
        "focused-reading-storage-embedding-failure-{}.sqlite3",
        std::process::id()
    ));
    let _ = fs::remove_file(&path);

    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "向量失败仍保存".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 10,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "文本索引必须先可用。".to_string(),
                markdown: "## Page 1\n\n文本索引必须先可用。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "文本索引必须先可用。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n文本索引必须先可用。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should still save when embedding provider fails");

    let summary = search_index_summary(&path, &saved.book_id).expect("index summary");
    assert_eq!(summary.chunk_count, 1);
    assert_eq!(summary.vector_count, 0);
    assert!(summary.fts_ready);
    assert!(summary
        .embedding_last_error
        .contains("failed to call embedding provider"));
    let hits = hybrid_search_book(&path, &saved.book_id, "文本索引", 3)
        .expect("text search should still work");
    assert!(chunk_id::is_namespaced_chunk_id(&hits[0].chunk_id));
    assert!(hits[0].chunk_id.contains("-p1-c1-"));

    let rebuilt =
        rebuild_search_index(&path, &saved.book_id).expect("rebuild should keep FTS usable");
    assert_eq!(rebuilt.chunk_count, 1);
    assert_eq!(rebuilt.vector_count, 0);
    assert!(rebuilt.fts_ready);
    assert!(rebuilt
        .embedding_last_error
        .contains("failed to call embedding provider"));

    let _ = fs::remove_file(&path);
    disable_embedding_provider();
    std::env::remove_var("EMBEDDING_API_KEY");
    std::env::remove_var("EMBEDDING_BASE_URL");
    std::env::remove_var("EMBEDDING_MODEL");
    std::env::remove_var("EMBEDDING_DIM");
}

#[test]
fn vector_search_skips_provider_when_index_has_last_error() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    isolate_provider_config("embedding-error-skip");
    clear_embedding_env();
    std::env::set_var("EMBEDDING_PROVIDER", "siliconflow");
    std::env::set_var("EMBEDDING_API_KEY", "invalid-key");
    std::env::set_var("EMBEDDING_BASE_URL", "http://127.0.0.1:1/v1/embeddings");
    std::env::set_var("EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B");
    std::env::set_var("EMBEDDING_DIM", "2560");
    let path = std::env::temp_dir().join(format!(
        "focused-reading-storage-embedding-error-skip-{}.sqlite3",
        std::process::id()
    ));
    let _ = fs::remove_file(&path);
    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "向量失败跳过".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "文本检索不依赖向量服务。".to_string(),
                markdown: "## Page 1\n\n文本检索不依赖向量服务。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "文本检索不依赖向量服务。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n文本检索不依赖向量服务。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save even when embedding provider fails");
    let conn = open_database(&path).expect("db should open");

    let vector_hits = vector_search(&conn, &saved.book_id, "semantic query", 3)
        .expect("recorded provider errors should skip vector search without reconnecting");
    assert!(vector_hits.is_empty());

    let _ = fs::remove_file(&path);
    disable_embedding_provider();
    std::env::remove_var("EMBEDDING_API_KEY");
    std::env::remove_var("EMBEDDING_BASE_URL");
    std::env::remove_var("EMBEDDING_MODEL");
    std::env::remove_var("EMBEDDING_DIM");
}

#[test]
fn vector_similarity_uses_cosine_not_vector_magnitude() {
    assert!(
        cosine_similarity(&[1.0, 0.0], &[1.0, 1.0])
            > cosine_similarity(&[1.0, 0.0], &[100.0, 400.0]),
        "semantic direction should outrank raw embedding magnitude"
    );
    assert_eq!(cosine_similarity(&[1.0, 0.0], &[0.0, 0.0]), 0.0);
}

struct FakeEmbeddingServer {
    embeddings_url: String,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl FakeEmbeddingServer {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("fake server should bind");
        listener
            .set_nonblocking(true)
            .expect("fake server should be nonblocking");
        let addr = listener.local_addr().expect("fake server address");
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let handle = thread::spawn(move || {
            while !thread_stop.load(AtomicOrdering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => handle_embedding_request(stream),
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });

        Self {
            embeddings_url: format!("http://{addr}/v1/embeddings"),
            stop,
            handle: Some(handle),
        }
    }

    fn embeddings_url(&self) -> String {
        self.embeddings_url.clone()
    }
}

impl Drop for FakeEmbeddingServer {
    fn drop(&mut self) {
        self.stop.store(true, AtomicOrdering::SeqCst);
        if let Ok(stream) = TcpStream::connect(
            self.embeddings_url
                .trim_start_matches("http://")
                .trim_end_matches("/v1/embeddings"),
        ) {
            drop(stream);
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn handle_embedding_request(mut stream: TcpStream) {
    let mut reader = BufReader::new(
        stream
            .try_clone()
            .expect("fake server should clone TCP stream"),
    );
    let mut content_length = 0_usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or_default() == 0 {
            return;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or_default();
        }
    }

    let mut body = vec![0_u8; content_length];
    if std::io::Read::read_exact(&mut reader, &mut body).is_err() {
        return;
    }
    let request: serde_json::Value =
        serde_json::from_slice(&body).expect("embedding request should be JSON");
    let inputs = match &request["input"] {
        serde_json::Value::Array(items) => items
            .iter()
            .map(|item| item.as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>(),
        serde_json::Value::String(item) => vec![item.clone()],
        _ => Vec::new(),
    };
    let data = inputs
        .iter()
        .enumerate()
        .map(|(index, input)| {
            serde_json::json!({
                "index": index,
                "embedding": fake_embedding_for(input),
            })
        })
        .collect::<Vec<_>>();
    let response = serde_json::json!({ "data": data }).to_string();
    let http = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response.len(),
            response
        );
    let _ = stream.write_all(http.as_bytes());
}

fn fake_embedding_for(input: &str) -> Vec<f32> {
    if input.contains("semantic-allocation") || input.contains("资产配置") {
        vec![1.0, 0.0, 0.0]
    } else if input.contains("长期主义") || input.contains("现金流") {
        vec![0.0, 1.0, 0.0]
    } else {
        vec![0.0, 0.0, 1.0]
    }
}

#[test]
fn fetches_chunks_neighbors_and_structure() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("tools");
    let _ = fs::remove_file(&path);
    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "工具测试".to_string(),
            total_pages: 3,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 12,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![
                ParsedPageInput {
                    page_index: 0,
                    text: "第一页".to_string(),
                    markdown: "## Page 1\n\n第一页".to_string(),
                },
                ParsedPageInput {
                    page_index: 1,
                    text: "第二页".to_string(),
                    markdown: "## Page 2\n\n第二页".to_string(),
                },
                ParsedPageInput {
                    page_index: 2,
                    text: "第三页".to_string(),
                    markdown: "## Page 3\n\n第三页".to_string(),
                },
            ],
            chunks: vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "第一页第一块".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n第一页第一块".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "p2-c1".to_string(),
                    page_index: 1,
                    text: "第二页第一块".to_string(),
                    markdown: "### [p2-c1] Page 2\n\n第二页第一块".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "p3-c1".to_string(),
                    page_index: 2,
                    text: "第三页第一块".to_string(),
                    markdown: "### [p3-c1] Page 3\n\n第三页第一块".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
            ],
        },
    )
    .expect("book should save");

    let chunk = get_chunk(&path, &saved.book_id, "p2-c1")
        .expect("chunk query should work")
        .expect("chunk should exist");
    assert_eq!(chunk.page_index, 1);
    assert!(chunk_id::is_namespaced_chunk_id(&chunk.chunk_id));

    let neighbors =
        get_neighbors(&path, &saved.book_id, "p2-c1", 1).expect("neighbors should load");
    assert_eq!(
        neighbors
            .iter()
            .map(|hit| hit.text.as_str())
            .collect::<Vec<_>>(),
        vec!["第一页第一块", "第二页第一块", "第三页第一块"]
    );
    assert!(neighbors
        .iter()
        .all(|hit| chunk_id::is_namespaced_chunk_id(&hit.chunk_id)));

    let structure = list_structure(&path, &saved.book_id).expect("structure should load");
    assert_eq!(structure.len(), 3);
    let _ = fs::remove_file(&path);
}

#[test]
fn lists_saved_books() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("list");
    let _ = fs::remove_file(&path);
    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "列表测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 12,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "一页文本".to_string(),
                markdown: "## Page 1\n\n一页文本".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "一页文本".to_string(),
                markdown: "### [p1-c1] Page 1\n\n一页文本".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    let books = list_books(&path).expect("books should list");
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].book_id, saved.book_id);
    assert_eq!(books[0].chunk_count, 1);
    assert!(books[0].text_char_count > 0);
    assert!(books[0].markdown_char_count > 0);
    assert_eq!(books[0].parser_engine, "test");
    assert_eq!(books[0].coordinate_mode, "text-only");
    assert!(!books[0].created_at.is_empty());
    assert!(books[0]
        .quality
        .as_ref()
        .is_some_and(|quality| quality.looks_usable));
    let _ = fs::remove_file(&path);
}

#[test]
fn copies_source_pdf_into_book_assets() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("pdf-copy");
    let _ = fs::remove_file(&path);
    let source_pdf = std::env::temp_dir().join(format!(
        "focused-reading-source-pdf-{}.pdf",
        std::process::id()
    ));
    fs::write(&source_pdf, b"%PDF-1.7\nfake fixture\n").expect("source PDF should write");

    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "PDF 资产测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 8,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: Some(source_pdf.to_string_lossy().to_string()),
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "PDF 已转换".to_string(),
                markdown: "## Page 1\n\nPDF 已转换".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "PDF 已转换".to_string(),
                markdown: "### [p1-c1] Page 1\n\nPDF 已转换".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    assert!(!saved.original_pdf_path.is_empty());
    assert_ne!(
        Path::new(&saved.original_pdf_path),
        source_pdf.as_path(),
        "source PDF should be copied into managed assets"
    );
    assert_eq!(
        fs::read(&saved.original_pdf_path).expect("copied PDF should read"),
        fs::read(&source_pdf).expect("source PDF should read")
    );
    let canonical_source_pdf = source_pdf
        .canonicalize()
        .expect("source PDF should canonicalize")
        .to_string_lossy()
        .to_string();
    assert_eq!(saved.source_pdf_path, canonical_source_pdf);
    assert!(saved.source_pdf_fingerprint.starts_with("pdf-fnv1a64-"));

    let asset = get_converted_book(&path, &saved.book_id).expect("asset should load");
    assert_eq!(asset.original_pdf_path, saved.original_pdf_path);
    assert_eq!(asset.source_pdf_path, saved.source_pdf_path);
    assert_eq!(asset.source_pdf_fingerprint, saved.source_pdf_fingerprint);
    let books = list_books(&path).expect("books should list");
    assert_eq!(books[0].original_pdf_path, saved.original_pdf_path);
    assert_eq!(books[0].source_pdf_path, saved.source_pdf_path);
    assert_eq!(
        books[0].source_pdf_fingerprint,
        saved.source_pdf_fingerprint
    );
    let matched = find_book_by_source_pdf(&path, &source_pdf)
        .expect("source PDF lookup should run")
        .expect("source PDF should match saved book");
    assert_eq!(matched.book_id, saved.book_id);
    let cached_response = SaveBookResponse::from_cached_book(matched);
    assert_eq!(cached_response.book_id, saved.book_id);
    assert_eq!(cached_response.chunk_count, saved.chunk_count);
    assert_eq!(cached_response.text_char_count, saved.text_char_count);
    assert_eq!(
        cached_response.markdown_char_count,
        saved.markdown_char_count
    );
    assert_eq!(cached_response.original_pdf_path, saved.original_pdf_path);
    assert_eq!(cached_response.source_pdf_path, saved.source_pdf_path);
    assert_eq!(
        cached_response.source_pdf_fingerprint,
        saved.source_pdf_fingerprint
    );

    let _ = fs::remove_file(&source_pdf);
    let _ = fs::remove_file(&saved.original_pdf_path);
    let _ = fs::remove_file(&path);
}

#[test]
fn copies_non_pdf_source_file_with_original_extension() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("epub-copy");
    let _ = fs::remove_file(&path);
    let source_epub = std::env::temp_dir().join(format!(
        "focused-reading-source-epub-{}.epub",
        std::process::id()
    ));
    fs::write(&source_epub, b"fake epub fixture").expect("source EPUB should write");

    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "EPUB 资产测试".to_string(),
            total_pages: 1,
            parser_engine: "text-import-epub".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 8,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: Some(source_epub.to_string_lossy().to_string()),
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "EPUB 已转换".to_string(),
                markdown: "# 第一章\n\nEPUB 已转换".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "EPUB 已转换".to_string(),
                markdown: "### [p1-c1] Page 1\n\nEPUB 已转换".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    assert!(saved.original_pdf_path.ends_with(".epub"));
    assert_ne!(Path::new(&saved.original_pdf_path), source_epub.as_path());
    assert_eq!(
        fs::read(&saved.original_pdf_path).expect("copied EPUB should read"),
        fs::read(&source_epub).expect("source EPUB should read")
    );
    let matched = find_book_by_source_pdf(&path, &source_epub)
        .expect("source lookup should run")
        .expect("source EPUB should match saved book");
    assert_eq!(matched.book_id, saved.book_id);

    let _ = fs::remove_file(&source_epub);
    let _ = fs::remove_file(&saved.original_pdf_path);
    let _ = fs::remove_file(&path);
}

#[test]
fn source_pdf_lookup_matches_legacy_fingerprint_rows() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("pdf-legacy-fingerprint");
    let _ = fs::remove_file(&path);
    let source_pdf = std::env::temp_dir().join(format!(
        "focused-reading-source-pdf-legacy-{}.pdf",
        std::process::id()
    ));
    fs::write(&source_pdf, b"%PDF-1.7\nlegacy fingerprint fixture\n")
        .expect("source PDF should write");

    let saved = save_book(
        &path,
        SaveBookRequest {
            title: "旧指纹兼容".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: Some(source_pdf.to_string_lossy().to_string()),
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "旧指纹也应该匹配。".to_string(),
                markdown: "## Page 1\n\n旧指纹也应该匹配。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "旧指纹也应该匹配。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n旧指纹也应该匹配。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    let legacy = legacy_source_file_fingerprint(
        &source_pdf
            .canonicalize()
            .expect("source PDF should canonicalize"),
        fs::metadata(&source_pdf)
            .expect("source PDF metadata should load")
            .len(),
    )
    .expect("legacy fingerprint should hash");
    let conn = open_database(&path).expect("database should open");
    conn.execute(
        "UPDATE book_assets SET source_pdf_fingerprint = ?1 WHERE book_id = ?2",
        params![legacy, saved.book_id],
    )
    .expect("legacy fingerprint should update");
    drop(conn);

    let matched = find_book_by_source_pdf(&path, &source_pdf)
        .expect("source PDF lookup should run")
        .expect("legacy source PDF should match saved book");
    assert_eq!(matched.book_id, saved.book_id);

    let _ = fs::remove_file(&source_pdf);
    let _ = fs::remove_file(&path);
}

#[test]
fn delete_book_removes_rows_fts_and_assets() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("delete-book");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "删除书籍测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "## Page 1\n\n复利来自时间。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    let asset_dir = converted_book_asset_dir(&path, &saved_book.book_id);
    assert!(asset_dir.exists());
    assert!(!search_book(&path, &saved_book.book_id, "复利", 5)
        .expect("search should work")
        .is_empty());

    let deleted = delete_book(&path, &saved_book.book_id).expect("book should delete");
    assert_eq!(deleted.book_id, saved_book.book_id);
    assert!(deleted.removed_asset_dir);
    assert!(!asset_dir.exists());
    assert!(list_books(&path).expect("books should list").is_empty());
    assert!(get_converted_book(&path, &saved_book.book_id).is_err());
    assert!(search_book(&path, &saved_book.book_id, "复利", 5)
        .expect("search should still run")
        .is_empty());

    let _ = fs::remove_file(&path);
}

#[test]
fn saves_lists_and_deletes_highlights() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("highlights");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "高亮测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 12,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "## Page 1\n\n复利来自时间。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    let highlight = save_highlight(
        &path,
        SaveHighlightRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "复利来自时间".to_string(),
            prefix: "前文".to_string(),
            suffix: "后文".to_string(),
            page_index: Some(0),
            position_start: Some(0),
            position_end: Some(6),
            rects: vec![NormalizedRectInput {
                page_index: 0,
                x0: 0.1,
                y0: 0.2,
                x1: 0.6,
                y1: 0.24,
            }],
            coordinate_version: COORDINATE_VERSION,
            interpretation: Some("解读内容".to_string()),
            evidence_chunk_ids: vec!["p1-c1".to_string()],
            evidence_chunk_snapshots: Vec::new(),
        },
    )
    .expect("highlight should save");

    let highlights = list_highlights(&path, &saved_book.book_id).expect("highlights list");
    assert_eq!(highlights.len(), 1);
    assert_eq!(highlights[0].id, highlight.id);
    assert_eq!(highlights[0].rects[0].x0, 0.1);
    assert_eq!(highlights[0].prefix, "前文");
    assert_eq!(highlights[0].page_index, Some(0));
    assert_eq!(highlights[0].position_start, Some(0));
    assert_eq!(highlights[0].position_end, Some(6));
    assert_eq!(highlights[0].coordinate_version, COORDINATE_VERSION);
    assert_eq!(highlights[0].evidence_chunk_ids.len(), 1);

    delete_highlight(&path, &highlight.id).expect("highlight should delete");
    let highlights = list_highlights(&path, &saved_book.book_id).expect("highlights list");
    assert!(highlights.is_empty());
    let _ = fs::remove_file(&path);
}

#[test]
fn saves_text_only_highlight_without_pdf_rects() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("text-only-highlights");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "文本高亮测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间和耐心。".to_string(),
                markdown: "## Page 1\n\n复利来自时间和耐心。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间和耐心。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n复利来自时间和耐心。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    let highlight = save_highlight(
        &path,
        SaveHighlightRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "时间和耐心".to_string(),
            prefix: "复利来自".to_string(),
            suffix: "。".to_string(),
            page_index: Some(0),
            position_start: Some(4),
            position_end: Some(9),
            rects: Vec::new(),
            coordinate_version: COORDINATE_VERSION,
            interpretation: None,
            evidence_chunk_ids: Vec::new(),
            evidence_chunk_snapshots: Vec::new(),
        },
    )
    .expect("text-only highlight should save");

    let highlights = list_highlights(&path, &saved_book.book_id).expect("highlights list");
    assert_eq!(highlights.len(), 1);
    assert_eq!(highlights[0].id, highlight.id);
    assert_eq!(highlights[0].page_index, Some(0));
    assert_eq!(highlights[0].position_start, Some(4));
    assert_eq!(highlights[0].position_end, Some(9));
    assert!(highlights[0].rects.is_empty());

    delete_highlight(&path, &highlight.id).expect("highlight should delete");
    assert!(list_highlights(&path, &saved_book.book_id)
        .expect("highlights list")
        .is_empty());
    let _ = fs::remove_file(&path);
}

#[test]
fn saves_and_lists_interpretations() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("interpretations");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "解读测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 12,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "## Page 1\n\n复利来自时间。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");
    let saved_chunk_id = get_chunk(&path, &saved_book.book_id, "p1-c1")
        .expect("legacy chunk alias should resolve")
        .expect("saved chunk should exist")
        .chunk_id;

    let saved = save_interpretation(
        &path,
        SaveInterpretationRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "复利来自时间".to_string(),
            session_id: Some("session-1".to_string()),
            turn_index: Some(1),
            prefix: "".to_string(),
            suffix: "。".to_string(),
            page_index: Some(0),
            position_start: Some(0),
            position_end: Some(6),
            page_indexes: vec![0],
            evidence_chunk_ids: vec!["p1-c1".to_string()],
            question: Some("为什么是时间？".to_string()),
            answer: "因为复利依赖长期积累。[p1-c1]".to_string(),
            answer_source: AnswerSource::Llm,
            kind: None,
            mode: None,
            evidence_chunk_snapshots: Vec::new(),
            trace: None,
        },
    )
    .expect("interpretation should save");

    let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, saved.id);
    assert_eq!(rows[0].session_id, "session-1");
    assert_eq!(rows[0].turn_index, 1);
    assert_eq!(rows[0].prefix, "");
    assert_eq!(rows[0].suffix, "。");
    assert_eq!(rows[0].page_index, Some(0));
    assert_eq!(rows[0].position_start, Some(0));
    assert_eq!(rows[0].position_end, Some(6));
    assert_eq!(rows[0].page_indexes, vec![0]);
    assert_eq!(rows[0].evidence_chunk_ids, vec![saved_chunk_id]);
    assert_eq!(rows[0].evidence_chunk_snapshots.len(), 1);
    assert_eq!(
        rows[0].evidence_chunk_snapshots[0].chunk_id,
        rows[0].evidence_chunk_ids[0]
    );
    assert_eq!(
        rows[0].evidence_chunk_snapshots[0].chunk_id_version,
        chunk_id::NAMESPACED_CHUNK_ID_VERSION
    );
    assert!(rows[0].evidence_chunk_snapshots[0]
        .content_hash
        .as_deref()
        .is_some_and(|hash| hash.len() == 8));
    assert_eq!(rows[0].question.as_deref(), Some("为什么是时间？"));
    assert_eq!(rows[0].kind, InterpretationKind::Interpretation);

    delete_interpretation(&path, &saved.id).expect("interpretation should delete");
    let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
    assert!(rows.is_empty());
    let _ = fs::remove_file(&path);
}

#[test]
fn saves_reads_and_clears_book_tldr_cache() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("book-tldr");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "TLDR 测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "## Page 1\n\n复利来自时间。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    assert!(get_book_tldr(&path, &saved_book.book_id)
        .expect("TLDR should read")
        .is_none());
    let saved_tldr = save_book_tldr(
        &path,
        &saved_book.book_id,
        "这本书解释复利为何依赖时间、纪律和风险控制。",
        "test/model",
        TLDR_SOURCE_VERSION,
        "rust-inline-1",
    )
    .expect("TLDR should save");
    assert_eq!(saved_tldr.book_id, saved_book.book_id);
    assert_eq!(saved_tldr.model, "test/model");
    assert_eq!(saved_tldr.source_version, TLDR_SOURCE_VERSION);
    assert_eq!(saved_tldr.engine_tag.as_deref(), Some("rust-inline-1"));

    let manifest =
        get_converted_book_manifest(&path, &saved_book.book_id).expect("manifest should load");
    assert_eq!(
        manifest.tldr_text.as_deref(),
        Some(saved_tldr.text.as_str())
    );
    assert_eq!(manifest.tldr_model.as_deref(), Some("test/model"));

    rebuild_search_index(&path, &saved_book.book_id).expect("index should rebuild");
    assert!(get_book_tldr(&path, &saved_book.book_id)
        .expect("TLDR should read after rebuild")
        .is_none());
    let _ = fs::remove_file(&path);
}

#[test]
fn resolves_missing_alias_by_chunk_locator_for_saved_interpretations() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("interpretation-locator-alias");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "旧别名兼容测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "## Page 1\n\n复利来自时间。".to_string(),
            }],
            chunks: vec![
                ParsedChunkInput {
                    chunk_id: "b503f19a9-p1-c1-deadbeef".to_string(),
                    page_index: 0,
                    text: "复利来自时间。".to_string(),
                    markdown: "### [b503f19a9-p1-c1-deadbeef] Page 1\n\n复利来自时间。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "b503f19a9-p1-c2-feedface".to_string(),
                    page_index: 0,
                    text: "现金流保持策略。".to_string(),
                    markdown: "### [b503f19a9-p1-c2-feedface] Page 1\n\n现金流保持策略。"
                        .to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
            ],
        },
    )
    .expect("book should save");
    let saved_chunk_id = get_converted_book(&path, &saved_book.book_id)
        .expect("asset should load")
        .chunks[0]
        .chunk_id
        .clone();
    let resolved = get_chunk(&path, &saved_book.book_id, "b503f19a9-p1-c1-deadbeef")
        .expect("locator fallback should query")
        .expect("locator fallback should resolve");
    assert_eq!(resolved.chunk_id, saved_chunk_id);

    let saved = save_interpretation(
        &path,
        SaveInterpretationRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "复利来自时间".to_string(),
            session_id: None,
            turn_index: Some(0),
            prefix: "".to_string(),
            suffix: "。".to_string(),
            page_index: Some(0),
            position_start: Some(0),
            position_end: Some(6),
            page_indexes: vec![0],
            evidence_chunk_ids: vec!["b503f19a9-p1-c1-deadbeef".to_string()],
            question: None,
            answer: "初始解读。[b503f19a9-p1-c1-deadbeef]".to_string(),
            answer_source: AnswerSource::Llm,
            kind: None,
            mode: None,
            evidence_chunk_snapshots: Vec::new(),
            trace: None,
        },
    )
    .expect("interpretation should save");

    let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
    assert_eq!(rows[0].id, saved.id);
    assert_eq!(rows[0].evidence_chunk_ids, vec![saved_chunk_id]);
    assert_eq!(
        rows[0].evidence_chunk_snapshots[0].content_hash.as_deref(),
        Some("deadbeef")
    );
    let _ = fs::remove_file(&path);
}

#[test]
fn rebinding_legacy_interpretation_ids_keeps_chunk_id_snapshots_auditable() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("interpretation-snapshot-reparse");
    let _ = fs::remove_file(&path);
    let first_book = save_book(
        &path,
        SaveBookRequest {
            title: "重解析审计测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "甲段。乙段。".to_string(),
                markdown: "## Page 1\n\n甲段。乙段。".to_string(),
            }],
            chunks: vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "甲段。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n甲段。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "p1-c2".to_string(),
                    page_index: 0,
                    text: "乙段。".to_string(),
                    markdown: "### [p1-c2] Page 1\n\n乙段。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
            ],
        },
    )
    .expect("first parse should save");
    let first_chunk_id = get_chunk(&path, &first_book.book_id, "p1-c2")
        .expect("legacy alias should resolve")
        .expect("chunk should exist")
        .chunk_id;
    let saved = save_interpretation(
        &path,
        SaveInterpretationRequest {
            book_id: first_book.book_id.clone(),
            selection_text: "乙段".to_string(),
            session_id: Some("snapshot-session".to_string()),
            turn_index: Some(0),
            prefix: "甲段。".to_string(),
            suffix: "".to_string(),
            page_index: Some(0),
            position_start: Some(3),
            position_end: Some(5),
            page_indexes: vec![0],
            evidence_chunk_ids: vec!["p1-c2".to_string()],
            question: None,
            answer: "乙段需要核对。[p1-c2]".to_string(),
            answer_source: AnswerSource::Llm,
            kind: None,
            mode: None,
            evidence_chunk_snapshots: Vec::new(),
            trace: None,
        },
    )
    .expect("interpretation should save");
    assert_eq!(saved.evidence_chunk_ids, vec![first_chunk_id.clone()]);

    let reparsed_book = save_book(
        &path,
        SaveBookRequest {
            title: "重解析审计测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "甲段。乙段。".to_string(),
                markdown: "## Page 1\n\n甲段。乙段。".to_string(),
            }],
            chunks: vec![
                ParsedChunkInput {
                    chunk_id: "p1-c1".to_string(),
                    page_index: 0,
                    text: "甲段。".to_string(),
                    markdown: "### [p1-c1] Page 1\n\n甲段。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
                ParsedChunkInput {
                    chunk_id: "p1-c2".to_string(),
                    page_index: 0,
                    text: "乙段更新。".to_string(),
                    markdown: "### [p1-c2] Page 1\n\n乙段更新。".to_string(),
                    rects: Vec::new(),
                    coordinate_version: COORDINATE_VERSION,
                },
            ],
        },
    )
    .expect("reparse should save");
    assert_eq!(reparsed_book.book_id, first_book.book_id);

    let rows = list_interpretations(&path, &first_book.book_id).expect("history should list");
    let rebound_chunk_id = get_chunk(&path, &first_book.book_id, "p1-c2")
        .expect("legacy alias should resolve after reparse")
        .expect("chunk should exist")
        .chunk_id;
    assert_ne!(rebound_chunk_id, first_chunk_id);
    assert_eq!(rows[0].id, saved.id);
    assert_eq!(rows[0].evidence_chunk_ids, vec![rebound_chunk_id]);
    let first_content_hash =
        chunk_id::locator_from_chunk_id(&first_chunk_id).and_then(|locator| locator.content_hash);
    assert_eq!(
        rows[0].evidence_chunk_snapshots[0].content_hash.as_deref(),
        first_content_hash.as_deref()
    );
    let _ = fs::remove_file(&path);
}

#[test]
fn preserves_unresolved_locator_chunk_id() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("unresolved-chunk-id-locator");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "无法解析 chunk id".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 6,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "只有一段。".to_string(),
                markdown: "## Page 1\n\n只有一段。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "只有一段。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n只有一段。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");
    let conn = open_database(&path).expect("db should open");

    let unresolved = resolve_chunk_id(&conn, &saved_book.book_id, "p9-c9")
        .expect("unresolved locator should preserve original id");

    assert_eq!(unresolved, "p9-c9");
    let _ = fs::remove_file(&path);
}

#[test]
fn deletes_all_interpretation_turns_in_a_session() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("interpretation-session");
    let _ = fs::remove_file(&path);
    let saved_book = save_book(
        &path,
        SaveBookRequest {
            title: "会话测试".to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: Some(TextQuality {
                char_count: 12,
                replacement_char_ratio: 0.0,
                control_char_ratio: 0.0,
                looks_usable: true,
            }),
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "## Page 1\n\n复利来自时间。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save");

    let first = save_interpretation(
        &path,
        SaveInterpretationRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "复利来自时间".to_string(),
            session_id: None,
            turn_index: Some(0),
            prefix: "".to_string(),
            suffix: "。".to_string(),
            page_index: Some(0),
            position_start: Some(0),
            position_end: Some(6),
            page_indexes: vec![0],
            evidence_chunk_ids: vec!["p1-c1".to_string()],
            question: None,
            answer: "初始解读。[p1-c1]".to_string(),
            answer_source: AnswerSource::Llm,
            kind: None,
            mode: None,
            evidence_chunk_snapshots: Vec::new(),
            trace: None,
        },
    )
    .expect("first turn should save");

    let follow_up = save_interpretation(
        &path,
        SaveInterpretationRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "复利来自时间".to_string(),
            session_id: Some(first.session_id.clone()),
            turn_index: Some(1),
            prefix: "".to_string(),
            suffix: "。".to_string(),
            page_index: Some(0),
            position_start: Some(0),
            position_end: Some(6),
            page_indexes: vec![0],
            evidence_chunk_ids: vec!["p1-c1".to_string()],
            question: Some("为什么？".to_string()),
            answer: "因为时间是变量。[p1-c1]".to_string(),
            answer_source: AnswerSource::LocalFallback,
            kind: None,
            mode: None,
            evidence_chunk_snapshots: Vec::new(),
            trace: None,
        },
    )
    .expect("follow-up should save");

    let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].turn_index, 0);
    assert_eq!(rows[1].turn_index, 1);
    assert_eq!(rows[1].session_id, first.session_id);

    delete_interpretation(&path, &follow_up.id).expect("session should delete");
    assert!(list_interpretations(&path, &saved_book.book_id)
        .expect("history should list")
        .is_empty());
    let _ = fs::remove_file(&path);
}

/// Build a minimal single-chunk book for cache-reuse tests. Embeddings are
/// disabled during the save so no provider is contacted.
#[cfg(test)]
fn save_single_chunk_book(path: &Path, title: &str) -> SaveBookResponse {
    save_book(
        path,
        SaveBookRequest {
            title: title.to_string(),
            total_pages: 1,
            parser_engine: "test".to_string(),
            coordinate_mode: "text-only".to_string(),
            quality: None,
            source_pdf_path: None,
            source_asset_dir: None,
            source_asset_dirs: Vec::new(),
            pages: vec![ParsedPageInput {
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "## Page 1\n\n复利来自时间。".to_string(),
            }],
            chunks: vec![ParsedChunkInput {
                chunk_id: "p1-c1".to_string(),
                page_index: 0,
                text: "复利来自时间。".to_string(),
                markdown: "### [p1-c1] Page 1\n\n复利来自时间。".to_string(),
                rects: Vec::new(),
                coordinate_version: COORDINATE_VERSION,
            }],
        },
    )
    .expect("book should save")
}

#[test]
fn interpretation_trace_round_trips_and_is_optional() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("interp-trace");
    let _ = fs::remove_file(&path);
    let saved_book = save_single_chunk_book(&path, "trace 测试");
    let saved_chunk_id = get_chunk(&path, &saved_book.book_id, "p1-c1")
        .expect("legacy chunk alias should resolve")
        .expect("saved chunk should exist")
        .chunk_id;

    let trace = serde_json::json!([
        {"phase": "plan", "query": null, "chunkIds": [], "note": "规划检索"},
        {"phase": "retrieve", "query": "复利", "chunkIds": [saved_chunk_id], "note": "命中一个块"},
    ]);
    let with_trace = save_interpretation(
        &path,
        SaveInterpretationRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "复利来自时间".to_string(),
            session_id: Some("trace-session".to_string()),
            turn_index: Some(0),
            prefix: String::new(),
            suffix: "。".to_string(),
            page_index: Some(0),
            position_start: Some(0),
            position_end: Some(6),
            page_indexes: vec![0],
            evidence_chunk_ids: vec!["p1-c1".to_string()],
            question: None,
            answer: "答案。[p1-c1]".to_string(),
            answer_source: AnswerSource::Llm,
            kind: None,
            mode: None,
            evidence_chunk_snapshots: Vec::new(),
            trace: Some(trace.clone()),
        },
    )
    .expect("interpretation with trace should save");
    // The saved struct and the listed row both carry the trace verbatim.
    assert_eq!(with_trace.trace.as_ref(), Some(&trace));

    let rows = list_interpretations(&path, &saved_book.book_id).expect("history should list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].trace.as_ref(), Some(&trace));

    // A second interpretation without a trace stores NULL and reads back as None
    // (the legacy/local-fallback shape) rather than erroring.
    let no_trace = save_interpretation(
        &path,
        SaveInterpretationRequest {
            book_id: saved_book.book_id.clone(),
            selection_text: "复利来自时间".to_string(),
            session_id: Some("plain-session".to_string()),
            turn_index: Some(0),
            prefix: String::new(),
            suffix: "。".to_string(),
            page_index: Some(0),
            position_start: Some(0),
            position_end: Some(6),
            page_indexes: vec![0],
            evidence_chunk_ids: vec!["p1-c1".to_string()],
            question: None,
            answer: "本地兜底答案。".to_string(),
            answer_source: AnswerSource::LocalFallback,
            kind: None,
            mode: None,
            evidence_chunk_snapshots: Vec::new(),
            trace: None,
        },
    )
    .expect("interpretation without trace should save");
    assert_eq!(no_trace.trace, None);
    let _ = fs::remove_file(&path);
}

#[test]
fn backfill_populates_chunk_embedding_hashes_matching_the_hasher() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    let path = temp_db("embed-backfill");
    let _ = fs::remove_file(&path);
    let saved_book = save_single_chunk_book(&path, "backfill 测试");

    let conn = open_database(&path).expect("open db");
    let chunks = fetch_chunks(&conn, &saved_book.book_id).expect("fetch chunks");
    assert_eq!(chunks.len(), 1);
    let chunk = &chunks[0];
    // Simulate a legacy vector row that predates the chunk_text_hash column.
    conn.execute(
        "INSERT INTO chunk_embeddings(book_id, chunk_id, provider, base_url, model, dimension, embedding_json, chunk_text_hash)
         VALUES (?1, ?2, 'siliconflow', 'http://embed.test', 'm', 4, '[0.1,0.2,0.3,0.4]', NULL)",
        params![saved_book.book_id, chunk.chunk_id],
    )
    .expect("insert legacy embedding row");

    backfill_chunk_embedding_hashes(&conn).expect("backfill should run");
    // Idempotent: a second run does not change an already-populated hash.
    backfill_chunk_embedding_hashes(&conn).expect("backfill is idempotent");

    let stored: Option<String> = conn
        .query_row(
            "SELECT chunk_text_hash FROM chunk_embeddings WHERE book_id = ?1 AND chunk_id = ?2",
            params![saved_book.book_id, chunk.chunk_id],
            |row| row.get(0),
        )
        .expect("read back hash");
    assert_eq!(
        stored.as_deref(),
        Some(embedding_input_hash(&chunk.text, &chunk.markdown).as_str()),
        "backfilled hash must equal the Rust hasher's output"
    );
    drop(conn);
    let _ = fs::remove_file(&path);
}

#[test]
fn rebuild_reuses_unchanged_vectors_without_calling_provider() {
    let _guard = crate::TEST_ENV_LOCK.lock().expect("env lock");
    // temp_db() disables embeddings so the initial save contacts no provider.
    let path = temp_db("embed-reuse");
    let _ = fs::remove_file(&path);
    let saved_book = save_single_chunk_book(&path, "reuse 测试");

    // Seed a cached vector that exactly matches the (soon-to-be) active config.
    let mut conn = open_database(&path).expect("open db");
    let chunks = fetch_chunks(&conn, &saved_book.book_id).expect("fetch chunks");
    let chunk = chunks[0].clone();
    let hash = embedding_input_hash(&chunk.text, &chunk.markdown);
    conn.execute(
        "INSERT INTO chunk_embeddings(book_id, chunk_id, provider, base_url, model, dimension, embedding_json, chunk_text_hash)
         VALUES (?1, ?2, 'siliconflow', 'http://embed.test', 'test-embed-model', 4, '[0.11,0.22,0.33,0.44]', ?3)",
        params![saved_book.book_id, chunk.chunk_id, hash],
    )
    .expect("seed reusable vector");

    // Point the active embedding config at that exact provider/model/dim so every
    // chunk is reusable and the provider is never contacted (a bogus base_url that
    // would fail if it were).
    std::env::set_var("EMBEDDING_PROVIDER", "siliconflow");
    std::env::set_var("EMBEDDING_API_KEY", "test-key");
    std::env::set_var("EMBEDDING_BASE_URL", "http://embed.test");
    std::env::set_var("EMBEDDING_MODEL", "test-embed-model");
    std::env::set_var("EMBEDDING_DIM", "4");

    let stats = rebuild_embeddings(&mut conn, &saved_book.book_id).expect("rebuild should reuse");
    assert_eq!(stats.reused, 1, "the unchanged chunk vector should be reused");
    assert_eq!(stats.embedded, 0, "no chunk should be re-embedded via the API");

    // The vector survived the rebuild verbatim and the index metadata is present.
    let (json, dim): (String, u32) = conn
        .query_row(
            "SELECT embedding_json, dimension FROM chunk_embeddings WHERE book_id = ?1 AND chunk_id = ?2",
            params![saved_book.book_id, chunk.chunk_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("vector should still exist");
    assert_eq!(json, "[0.11,0.22,0.33,0.44]");
    assert_eq!(dim, 4);
    let index_dim: u32 = conn
        .query_row(
            "SELECT dimension FROM embedding_indexes WHERE book_id = ?1",
            params![saved_book.book_id],
            |row| row.get(0),
        )
        .expect("index metadata should exist");
    assert_eq!(index_dim, 4);

    drop(conn);
    clear_embedding_env();
    disable_embedding_provider();
    let _ = fs::remove_file(&path);
}
