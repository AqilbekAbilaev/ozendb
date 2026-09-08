use super::{AppError, CsvOptions};
use mongodb::bson;

struct CsvRecords<R: std::io::Read> {
    bytes: std::io::Bytes<R>,
    // One-byte look-ahead buffer, used to detect a doubled quote (`""`) and to peek
    // the byte after a closing quote.
    peeked: Option<u8>,
    finished: bool,
    // The field separator and text qualifier bytes (configurable, hence compared at
    // runtime rather than matched against byte literals).
    delimiter: u8,
    quote: u8,
}

impl<R: std::io::Read> CsvRecords<R> {
    fn new(reader: R, delimiter: u8, quote: u8) -> Self {
        CsvRecords {
            bytes: reader.bytes(),
            peeked: None,
            finished: false,
            delimiter,
            quote,
        }
    }

    fn next_byte(&mut self) -> Result<Option<u8>, AppError> {
        match self.peeked.take() {
            Some(byte) => Ok(Some(byte)),
            None => match self.bytes.next() {
                Some(Ok(byte)) => Ok(Some(byte)),
                Some(Err(e)) => Err(AppError::Io(e)),
                None => Ok(None),
            },
        }
    }

    fn peek_byte(&mut self) -> Result<Option<u8>, AppError> {
        if self.peeked.is_none() {
            match self.bytes.next() {
                Some(Ok(byte)) => self.peeked = Some(byte),
                Some(Err(e)) => return Err(AppError::Io(e)),
                None => return Ok(None),
            }
        }
        Ok(self.peeked)
    }

    fn field_to_string(bytes: Vec<u8>) -> Result<String, AppError> {
        String::from_utf8(bytes)
            .map_err(|e| AppError::Bson(format!("Import file is not valid UTF-8: {e}")))
    }

    fn next_record(&mut self) -> Result<Option<Vec<String>>, AppError> {
        if self.finished {
            return Ok(None);
        }
        let mut record = Vec::new();
        let mut field = Vec::new();
        let mut in_quotes = false;
        loop {
            let byte = match self.next_byte()? {
                Some(byte) => byte,
                None => {
                    self.finished = true;
                    if !field.is_empty() || !record.is_empty() {
                        record.push(Self::field_to_string(field)?);
                        return Ok(Some(record));
                    }
                    return Ok(None);
                }
            };
            if in_quotes {
                if byte == self.quote {
                    match self.peek_byte()? {
                        Some(next) if next == self.quote => {
                            self.peeked = None;
                            field.push(self.quote);
                        }
                        _ => in_quotes = false,
                    }
                } else {
                    field.push(byte);
                }
            } else if byte == self.quote {
                in_quotes = true;
            } else if byte == self.delimiter {
                record.push(Self::field_to_string(std::mem::take(&mut field))?);
            } else if byte == b'\n' {
                record.push(Self::field_to_string(std::mem::take(&mut field))?);
                return Ok(Some(record));
            } else if byte != b'\r' {
                field.push(byte);
            }
        }
    }
}

fn coerce_csv_value(cell: &str) -> bson::Bson {
    let trimmed = cell.trim();
    if trimmed.is_empty() {
        return bson::Bson::Null;
    }
    if trimmed == "true" {
        return bson::Bson::Boolean(true);
    }
    if trimmed == "false" {
        return bson::Bson::Boolean(false);
    }
    if let Ok(value) = trimmed.parse::<i64>() {
        return bson::Bson::Int64(value);
    }
    if let Ok(value) = trimmed.parse::<f64>() {
        return bson::Bson::Double(value);
    }
    bson::Bson::String(cell.to_string())
}

fn csv_row_is_blank(row: &[String]) -> bool {
    row.iter().all(|cell| cell.is_empty())
}

fn csv_row_to_document(headers: &[String], row: &[String]) -> bson::Document {
    let mut doc = bson::Document::new();
    for (idx, header) in headers.iter().enumerate() {
        let cell = row.get(idx).map_or("", String::as_str);
        doc.insert(header.clone(), coerce_csv_value(cell));
    }
    doc
}

pub(super) fn stream_csv_documents<R, F>(
    reader: R,
    options: CsvOptions,
    batch_size: usize,
    mut flush: F,
) -> Result<usize, AppError>
where
    R: std::io::Read,
    F: FnMut(Vec<bson::Document>) -> Result<(), AppError>,
{
    let mut records = CsvRecords::new(reader, options.delimiter, options.quote);
    for _ in 0..options.skip_lines {
        if records.next_record()?.is_none() {
            return Ok(0);
        }
    }
    let mut batch = Vec::with_capacity(batch_size);
    let mut total = 0;
    let headers = if options.has_headers {
        match records.next_record()? {
            Some(row) => row,
            None => return Ok(0),
        }
    } else {
        let first = match records.next_record()? {
            Some(row) => row,
            None => return Ok(0),
        };
        let headers = (1..=first.len()).map(|i| format!("field{i}")).collect::<Vec<_>>();
        if !csv_row_is_blank(&first) {
            batch.push(csv_row_to_document(&headers, &first));
        }
        headers
    };
    while let Some(row) = records.next_record()? {
        if csv_row_is_blank(&row) {
            continue;
        }
        batch.push(csv_row_to_document(&headers, &row));
        if batch.len() >= batch_size {
            total += batch.len();
            flush(std::mem::take(&mut batch))?;
        }
    }
    if !batch.is_empty() {
        total += batch.len();
        flush(batch)?;
    }
    Ok(total)
}
