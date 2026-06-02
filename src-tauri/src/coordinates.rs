use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const COORDINATE_VERSION: u32 = 1;
const EPSILON: f64 = 1e-9;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPageRect {
    pub page_index: u32,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Error, PartialEq)]
pub enum CoordinateError {
    #[error("coordinate must be finite")]
    NotFinite,
    #[error("page size must be positive")]
    InvalidPageSize,
    #[error("rect must have positive width and height")]
    EmptyRect,
    #[error("unsupported page rotation {0}; expected 0, 90, 180, or 270")]
    UnsupportedRotation(i32),
}

pub fn top_left_points_to_normalized(
    page_index: u32,
    bbox: [f64; 4],
    page_size: PageSize,
) -> Result<NormalizedPageRect, CoordinateError> {
    assert_page_size(page_size)?;
    normalize_rect(NormalizedPageRect {
        page_index,
        x0: bbox[0] / page_size.width,
        y0: bbox[1] / page_size.height,
        x1: bbox[2] / page_size.width,
        y1: bbox[3] / page_size.height,
    })
}

pub fn mineru_bbox_to_normalized(
    page_index: u32,
    bbox: [f64; 4],
    page_size: PageSize,
) -> Result<NormalizedPageRect, CoordinateError> {
    top_left_points_to_normalized(page_index, bbox, page_size)
}

pub fn top_left_points_to_normalized_with_rotation(
    page_index: u32,
    bbox: [f64; 4],
    page_size: PageSize,
    rotation_degrees: i32,
) -> Result<NormalizedPageRect, CoordinateError> {
    assert_page_size(page_size)?;
    let rotation = normalize_rotation(rotation_degrees)?;
    let display_size = rotated_page_size(page_size, rotation);
    let mut x_values = Vec::with_capacity(4);
    let mut y_values = Vec::with_capacity(4);
    for x in [bbox[0], bbox[2]] {
        for y in [bbox[1], bbox[3]] {
            let (rotated_x, rotated_y) = rotate_top_left_point(x, y, page_size, rotation);
            x_values.push(rotated_x);
            y_values.push(rotated_y);
        }
    }
    normalize_rect(NormalizedPageRect {
        page_index,
        x0: min_finite(&x_values)? / display_size.width,
        y0: min_finite(&y_values)? / display_size.height,
        x1: max_finite(&x_values)? / display_size.width,
        y1: max_finite(&y_values)? / display_size.height,
    })
}

pub fn top_left_points_in_crop_box_to_normalized(
    page_index: u32,
    bbox: [f64; 4],
    crop_box: [f64; 4],
) -> Result<NormalizedPageRect, CoordinateError> {
    let [left, top, right, bottom] = ordered_box(crop_box)?;
    let width = right - left;
    let height = bottom - top;
    if width <= 0.0 || height <= 0.0 {
        return Err(CoordinateError::InvalidPageSize);
    }
    normalize_rect(NormalizedPageRect {
        page_index,
        x0: (bbox[0] - left) / width,
        y0: (bbox[1] - top) / height,
        x1: (bbox[2] - left) / width,
        y1: (bbox[3] - top) / height,
    })
}

pub fn pdf_bottom_left_points_to_normalized(
    page_index: u32,
    bbox: [f64; 4],
    page_size: PageSize,
) -> Result<NormalizedPageRect, CoordinateError> {
    assert_page_size(page_size)?;
    normalize_rect(NormalizedPageRect {
        page_index,
        x0: bbox[0] / page_size.width,
        y0: (page_size.height - bbox[3]) / page_size.height,
        x1: bbox[2] / page_size.width,
        y1: (page_size.height - bbox[1]) / page_size.height,
    })
}

pub fn normalize_rect(rect: NormalizedPageRect) -> Result<NormalizedPageRect, CoordinateError> {
    let mut values = [rect.x0, rect.y0, rect.x1, rect.y1];
    if values.iter().any(|value| !value.is_finite()) {
        return Err(CoordinateError::NotFinite);
    }

    for value in &mut values {
        *value = value.clamp(0.0, 1.0);
    }

    let x0 = values[0].min(values[2]);
    let x1 = values[0].max(values[2]);
    let y0 = values[1].min(values[3]);
    let y1 = values[1].max(values[3]);

    if x1 - x0 <= EPSILON || y1 - y0 <= EPSILON {
        return Err(CoordinateError::EmptyRect);
    }

    Ok(NormalizedPageRect {
        page_index: rect.page_index,
        x0,
        y0,
        x1,
        y1,
    })
}

fn assert_page_size(page_size: PageSize) -> Result<(), CoordinateError> {
    if !page_size.width.is_finite() || !page_size.height.is_finite() {
        return Err(CoordinateError::NotFinite);
    }
    if page_size.width <= 0.0 || page_size.height <= 0.0 {
        return Err(CoordinateError::InvalidPageSize);
    }
    Ok(())
}

fn normalize_rotation(rotation_degrees: i32) -> Result<i32, CoordinateError> {
    let normalized = rotation_degrees.rem_euclid(360);
    match normalized {
        0 | 90 | 180 | 270 => Ok(normalized),
        _ => Err(CoordinateError::UnsupportedRotation(rotation_degrees)),
    }
}

fn rotated_page_size(page_size: PageSize, rotation: i32) -> PageSize {
    match rotation {
        90 | 270 => PageSize {
            width: page_size.height,
            height: page_size.width,
        },
        _ => page_size,
    }
}

fn rotate_top_left_point(x: f64, y: f64, page_size: PageSize, rotation: i32) -> (f64, f64) {
    match rotation {
        90 => (page_size.height - y, x),
        180 => (page_size.width - x, page_size.height - y),
        270 => (y, page_size.width - x),
        _ => (x, y),
    }
}

fn ordered_box(bbox: [f64; 4]) -> Result<[f64; 4], CoordinateError> {
    if bbox.iter().any(|value| !value.is_finite()) {
        return Err(CoordinateError::NotFinite);
    }
    Ok([
        bbox[0].min(bbox[2]),
        bbox[1].min(bbox[3]),
        bbox[0].max(bbox[2]),
        bbox[1].max(bbox[3]),
    ])
}

fn min_finite(values: &[f64]) -> Result<f64, CoordinateError> {
    values
        .iter()
        .copied()
        .try_fold(f64::INFINITY, |acc, value| {
            if !value.is_finite() {
                Err(CoordinateError::NotFinite)
            } else {
                Ok(acc.min(value))
            }
        })
}

fn max_finite(values: &[f64]) -> Result<f64, CoordinateError> {
    values
        .iter()
        .copied()
        .try_fold(f64::NEG_INFINITY, |acc, value| {
            if !value.is_finite() {
                Err(CoordinateError::NotFinite)
            } else {
                Ok(acc.max(value))
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn converts_mineru_top_left_points() {
        let rect = expect_ok(
            mineru_bbox_to_normalized(
                0,
                [67.0, 63.0, 359.0, 80.0],
                PageSize {
                    width: 595.0,
                    height: 841.0,
                },
            ),
            "MinerU top-left bbox should normalize",
        );

        assert_eq!(
            rect,
            NormalizedPageRect {
                page_index: 0,
                x0: 67.0 / 595.0,
                y0: 63.0 / 841.0,
                x1: 359.0 / 595.0,
                y1: 80.0 / 841.0,
            }
        );
    }

    #[test]
    fn flips_bottom_left_points() {
        let rect = expect_ok(
            pdf_bottom_left_points_to_normalized(
                0,
                [10.0, 20.0, 110.0, 120.0],
                PageSize {
                    width: 200.0,
                    height: 400.0,
                },
            ),
            "bottom-left PDF points should normalize",
        );

        assert_eq!(
            rect,
            NormalizedPageRect {
                page_index: 0,
                x0: 0.05,
                y0: 0.7,
                x1: 0.55,
                y1: 0.95,
            }
        );
    }

    #[test]
    fn rejects_empty_rectangles() {
        let err = expect_err(
            mineru_bbox_to_normalized(
                0,
                [100.0, 100.0, 100.0, 200.0],
                PageSize {
                    width: 595.0,
                    height: 841.0,
                },
            ),
            "zero-width bbox should be rejected",
        );

        assert_eq!(err, CoordinateError::EmptyRect);
    }

    #[test]
    fn rotates_top_left_point_boxes_clockwise_into_display_space() {
        let page_size = PageSize {
            width: 200.0,
            height: 400.0,
        };
        let bbox = [10.0, 20.0, 110.0, 120.0];

        assert_eq!(
            expect_ok(
                top_left_points_to_normalized_with_rotation(0, bbox, page_size, 90),
                "90 degree rotation should normalize",
            ),
            NormalizedPageRect {
                page_index: 0,
                x0: 280.0 / 400.0,
                y0: 10.0 / 200.0,
                x1: 380.0 / 400.0,
                y1: 110.0 / 200.0,
            }
        );
        assert_eq!(
            expect_ok(
                top_left_points_to_normalized_with_rotation(0, bbox, page_size, 180),
                "180 degree rotation should normalize",
            ),
            NormalizedPageRect {
                page_index: 0,
                x0: 90.0 / 200.0,
                y0: 280.0 / 400.0,
                x1: 190.0 / 200.0,
                y1: 380.0 / 400.0,
            }
        );
        assert_eq!(
            expect_ok(
                top_left_points_to_normalized_with_rotation(0, bbox, page_size, 270),
                "270 degree rotation should normalize",
            ),
            NormalizedPageRect {
                page_index: 0,
                x0: 20.0 / 400.0,
                y0: 90.0 / 200.0,
                x1: 120.0 / 400.0,
                y1: 190.0 / 200.0,
            }
        );
    }

    #[test]
    fn normalizes_top_left_points_inside_crop_box() {
        let rect = expect_ok(
            top_left_points_in_crop_box_to_normalized(
                0,
                [60.0, 120.0, 160.0, 220.0],
                [50.0, 100.0, 250.0, 500.0],
            ),
            "top-left points inside crop box should normalize",
        );

        assert_eq!(
            rect,
            NormalizedPageRect {
                page_index: 0,
                x0: 10.0 / 200.0,
                y0: 20.0 / 400.0,
                x1: 110.0 / 200.0,
                y1: 120.0 / 400.0,
            }
        );
    }

    #[test]
    fn rejects_non_right_angle_rotation() {
        let err = expect_err(
            top_left_points_to_normalized_with_rotation(
                0,
                [10.0, 20.0, 110.0, 120.0],
                PageSize {
                    width: 200.0,
                    height: 400.0,
                },
                45,
            ),
            "non-right-angle rotation should be rejected",
        );

        assert_eq!(err, CoordinateError::UnsupportedRotation(45));
    }

    #[test]
    fn rejects_non_finite_bbox_values() {
        let err = expect_err(
            top_left_points_to_normalized(
                0,
                [10.0, f64::NAN, 110.0, 120.0],
                PageSize {
                    width: 200.0,
                    height: 400.0,
                },
            ),
            "non-finite bbox values should be rejected",
        );

        assert_eq!(err, CoordinateError::NotFinite);
    }

    #[test]
    fn rejects_invalid_page_size() {
        let err = expect_err(
            mineru_bbox_to_normalized(
                0,
                [10.0, 20.0, 110.0, 120.0],
                PageSize {
                    width: 0.0,
                    height: 400.0,
                },
            ),
            "zero-width page size should be rejected",
        );

        assert_eq!(err, CoordinateError::InvalidPageSize);
    }

    fn expect_ok<T: std::fmt::Debug, E: std::fmt::Debug>(result: Result<T, E>, context: &str) -> T {
        assert!(result.is_ok(), "{context}: {result:?}");
        result.unwrap_or_else(|_| unreachable!("asserted result is ok"))
    }

    fn expect_err<T: std::fmt::Debug, E: std::fmt::Debug>(
        result: Result<T, E>,
        context: &str,
    ) -> E {
        assert!(
            result.is_err(),
            "{context}: unexpectedly succeeded with {result:?}"
        );
        result
            .err()
            .unwrap_or_else(|| unreachable!("asserted result is err"))
    }
}
