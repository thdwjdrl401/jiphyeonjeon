#!/bin/sh
set -eu

dataset_root=${1:-/home/liveclass/ai/datasets/aihub-korean-lecture/v1}

if ! command -v bsdtar >/dev/null 2>&1; then
  echo "bsdtar is required" >&2
  exit 1
fi

extract_archives() {
  kind=$1
  archive_root=$dataset_root/raw/$kind
  extracted_root=$dataset_root/extracted/$kind
  found=0

  if [ ! -d "$archive_root" ]; then
    echo "archive directory does not exist: $archive_root" >&2
    exit 1
  fi

  for archive in "$archive_root"/*.zip; do
    [ -f "$archive" ] || continue
    found=1
    archive_name=$(basename "$archive" .zip)
    destination=$extracted_root/$archive_name
    marker=$destination/.source-archive-sha256

    echo "checking $archive"
    bsdtar -tf "$archive" >/dev/null
    if bsdtar -tf "$archive" | awk '
      /^\// || /(^|\/)\.\.($|\/)/ || /\\/ { invalid = 1 }
      END { exit invalid }
    '; then
      :
    else
      echo "archive contains an unsafe path: $archive" >&2
      exit 2
    fi

    archive_sha=$(sha256sum "$archive" | awk '{print $1}')
    if [ -f "$marker" ] && [ "$(sed -n '1p' "$marker")" = "$archive_sha" ]; then
      echo "already extracted: $archive"
      continue
    fi
    if [ -e "$destination" ]; then
      echo "destination already exists without a matching marker: $destination" >&2
      echo "inspect it and choose a clean destination before retrying" >&2
      exit 2
    fi

    mkdir -p "$destination"
    bsdtar -xf "$archive" -C "$destination"
    printf '%s\n' "$archive_sha" >"$marker"
    echo "extracted $archive -> $destination"
  done

  if [ "$found" -eq 0 ]; then
    echo "no ZIP archives found in $archive_root" >&2
    exit 1
  fi
}

extract_archives annotations
extract_archives audio
