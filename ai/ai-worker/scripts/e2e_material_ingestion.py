from __future__ import annotations

import argparse
from io import BytesIO
import json
import time
from uuid import uuid4

import httpx
from pptx import Presentation
import psycopg


PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _pptx_bytes() -> bytes:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = "LiveClass material ingestion E2E"
    slide.placeholders[
        1
    ].text = "강사가 올린 PPTX가 실제 BGE-M3 임베딩과 pgvector 저장까지 연결됩니다."
    output = BytesIO()
    presentation.save(output)
    return output.getvalue()


def _csrf(client: httpx.Client) -> dict[str, str]:
    response = client.get("/api/auth/csrf")
    response.raise_for_status()
    payload = response.json()
    return {str(payload["headerName"]): str(payload["token"])}


def _post(
    client: httpx.Client,
    path: str,
    csrf_header: dict[str, str],
    payload: dict[str, object],
    *,
    expected: int,
) -> dict[str, object]:
    response = client.post(path, headers=csrf_header, json=payload)
    if response.status_code != expected:
        raise RuntimeError(f"POST {path} returned {response.status_code}: {response.text[:500]}")
    return response.json() if response.content else {}


def _upload_material(client: httpx.Client, csrf_header: dict[str, str], source: bytes) -> str:
    ticket = _post(
        client,
        "/api/assets/upload-requests",
        csrf_header,
        {
            "kind": "MATERIAL",
            "fileName": "material-ingestion-e2e.pptx",
            "contentType": PPTX_MEDIA_TYPE,
            "fileSize": len(source),
        },
        expected=200,
    )
    upload_headers = {str(key): str(value) for key, value in dict(ticket["headers"]).items()}
    upload = httpx.put(str(ticket["uploadUrl"]), headers=upload_headers, content=source, timeout=30)
    if upload.status_code not in {200, 204}:
        raise RuntimeError(f"presigned PUT returned {upload.status_code}: {upload.text[:500]}")
    asset_id = str(ticket["assetId"])
    _post(client, f"/api/assets/{asset_id}/complete", csrf_header, {}, expected=200)
    return asset_id


def _wait_until_ready(
    client: httpx.Client,
    lesson_id: str,
    material_id: str,
    *,
    timeout_seconds: float,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_status = "UNKNOWN"
    while time.monotonic() < deadline:
        response = client.get(f"/api/instructor/lessons/{lesson_id}")
        response.raise_for_status()
        materials = response.json().get("materials", [])
        target = next(
            (item for item in materials if str(item.get("materialId")) == material_id),
            None,
        )
        if target is not None:
            last_status = str(target.get("embeddingStatus"))
            if last_status == "READY":
                return
            if last_status == "FAILED":
                raise RuntimeError("material embedding callback reported FAILED")
        time.sleep(1)
    raise TimeoutError(
        f"material did not become READY within {timeout_seconds}s (last={last_status})"
    )


def _index_summary(database_url: str, material_id: str) -> dict[str, object]:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT mv.state,
                   count(DISTINCT dc.id) AS chunk_count,
                   count(DISTINCT ce.chunk_id) AS embedding_count,
                   min(ce.dimensions) AS dimensions
            FROM ai.material_version mv
            LEFT JOIN ai.document_chunk dc ON dc.material_version_id = mv.id
            LEFT JOIN ai.chunk_embedding ce ON ce.chunk_id = dc.id
            WHERE mv.material_id = %s
            GROUP BY mv.id, mv.state
            ORDER BY mv.id DESC
            LIMIT 1
            """,
            (material_id,),
        ).fetchone()
    if row is None:
        raise RuntimeError("ai.material_version was not created")
    state, chunk_count, embedding_count, dimensions = row
    if state != "ACTIVE" or chunk_count < 1 or embedding_count != chunk_count or dimensions != 1024:
        raise RuntimeError(
            "invalid index result: "
            f"state={state}, chunks={chunk_count}, embeddings={embedding_count}, dimensions={dimensions}"
        )
    return {
        "state": state,
        "chunkCount": chunk_count,
        "embeddingCount": embedding_count,
        "dimensions": dimensions,
    }


def run(base_url: str, database_url: str, timeout_seconds: float) -> None:
    suffix = uuid4().hex[:12]
    email = f"material-e2e-{suffix}@liveclass.test"
    password = "material-e2e-password"
    source = _pptx_bytes()

    with httpx.Client(base_url=base_url, timeout=15, follow_redirects=False) as client:
        csrf_header = _csrf(client)
        _post(
            client,
            "/api/auth/signup",
            csrf_header,
            {
                "email": email,
                "password": password,
                "displayName": "Material E2E Instructor",
                "role": "INSTRUCTOR",
            },
            expected=201,
        )
        _post(
            client,
            "/api/auth/login",
            csrf_header,
            {"email": email, "password": password},
            expected=200,
        )
        csrf_header = _csrf(client)
        curriculum = _post(
            client,
            "/api/instructor/curriculums",
            csrf_header,
            {
                "title": f"Material E2E {suffix}",
                "summary": "PPTX ingestion E2E",
                "description": "isolated local verification",
                "thumbnailAssetId": None,
            },
            expected=201,
        )
        curriculum_id = str(curriculum["curriculumId"])
        section = _post(
            client,
            f"/api/instructor/curriculums/{curriculum_id}/sections",
            csrf_header,
            {"title": "E2E section", "description": "material ingestion"},
            expected=201,
        )
        section_id = str(section["sectionId"])
        lesson = _post(
            client,
            f"/api/instructor/sections/{section_id}/lessons",
            csrf_header,
            {"title": "E2E lesson", "description": "material ingestion"},
            expected=201,
        )
        lesson_id = str(lesson["lessonId"])
        asset_id = _upload_material(client, csrf_header, source)
        material = _post(
            client,
            f"/api/instructor/lessons/{lesson_id}/materials",
            csrf_header,
            {"assetId": asset_id},
            expected=201,
        )
        material_id = str(material["materialId"])
        _wait_until_ready(
            client,
            lesson_id,
            material_id,
            timeout_seconds=timeout_seconds,
        )

    summary = _index_summary(database_url, material_id)
    print(
        json.dumps(
            {
                "status": "ok",
                "curriculumId": curriculum_id,
                "lessonId": lesson_id,
                "materialId": material_id,
                **summary,
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the real PPTX material ingestion E2E")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument(
        "--database-url",
        default="postgresql://liveclass:liveclass@127.0.0.1:5432/liveclass",
    )
    parser.add_argument("--timeout-seconds", type=float, default=180)
    args = parser.parse_args()
    run(args.base_url, args.database_url, args.timeout_seconds)


if __name__ == "__main__":
    main()
