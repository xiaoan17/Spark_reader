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
