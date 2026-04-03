#!/bin/sh
set -e

VERSION=${1:-dev}
IMAGE="homebuyers-union:$VERSION"
PORT=${2:-8080}

docker build -t "$IMAGE" .
docker run --rm -p "$PORT:80" "$IMAGE"
