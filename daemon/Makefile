VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.buildTime=$(BUILD_TIME)
BINARY := justavps-daemon

.PHONY: build build-linux test clean

# Build for current platform
build:
	go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY) .

# Build for Linux amd64 (target platform for Hetzner VPS)
build-linux:
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/$(BINARY)-linux-amd64 .

# Build for both
build-all: build build-linux

# Run tests
test:
	go test -v ./...

# Clean build artifacts
clean:
	rm -rf bin/

# Run locally
run: build
	./bin/$(BINARY) --config testdata/config.json
