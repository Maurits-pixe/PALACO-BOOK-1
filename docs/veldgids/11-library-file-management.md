# De Mentale Veldgids — Block 11: Library & File Management

Status: DESIGN-READY
Scope: user knowledge workspace

## Purpose
The Library stores source artifacts without making them authoritative by default.

## Supported source classes
- PDF
- DOCX
- TXT / Markdown
- image
- audio
- video
- URL/web reference
- research record

## Lifecycle
INGESTED -> CLASSIFIED -> EXTRACTED -> INDEXED -> REVIEWED -> AVAILABLE
A source may also become REVOKED or ARCHIVED.

## Rules
1. Original source bytes are immutable once ingested.
2. Derived text/transcripts are separate artifacts.
3. Every derived artifact records its parent source.
4. Deletion is represented as a governed lifecycle event, not silent disappearance.
5. Library metadata never grants authority to a knowledge object.

## Minimum metadata
source_id, title, media_type, checksum, origin, creator, publication_date, ingested_at, version, provenance_status.

## Relation to De Levensader
Library = source layer.
Levensader = knowledge layer.
Knowledge Objects reference sources; they do not replace them.
