FROM golang:1.26-alpine AS builder
WORKDIR /app

# CGO disabled → pure static binary, no gcc/musl-dev needed
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server ./cmd/server

# ---- Production runner ----
FROM alpine:3.21
WORKDIR /app

# Runtime deps: HTTPS/S3, timezone data, wget for HEALTHCHECK
RUN apk add --no-cache ca-certificates tzdata wget

# Non-root user
RUN addgroup -g 1001 -S app && \
    adduser -S app -u 1001 -G app

COPY --from=builder /app/server .
COPY --from=builder /app/web ./web

RUN mkdir -p uploads && chown -R app:app /app

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:8080/healthz || exit 1

CMD ["./server"]
