package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"reflect"
	"testing"
)

func TestToolBootstrapperRunRequiresRoot(t *testing.T) {
	var called bool
	b := &toolBootstrapper{
		commandExists: func(string) bool { return false },
		runCommand: func(context.Context, string, ...string) error {
			called = true
			return nil
		},
		logger: log.New(&bytes.Buffer{}, "", 0),
	}

	origGeteuid := osGeteuid
	osGeteuid = func() int { return 1000 }
	defer func() { osGeteuid = origGeteuid }()

	b.Run(context.Background())

	if called {
		t.Fatal("expected bootstrap to skip when not running as root")
	}
}

func TestToolBootstrapperRunStopsWhenContextCancelled(t *testing.T) {
	var called bool
	b := &toolBootstrapper{
		commandExists: func(string) bool { return false },
		runCommand: func(context.Context, string, ...string) error {
			called = true
			return nil
		},
		logger: log.New(&bytes.Buffer{}, "", 0),
	}

	origGeteuid := osGeteuid
	osGeteuid = func() int { return 0 }
	defer func() { osGeteuid = origGeteuid }()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	b.Run(ctx)

	if called {
		t.Fatal("expected cancelled context to skip bootstrap work")
	}
}

func TestToolBootstrapperInstallsPNPMViaCorepack(t *testing.T) {
	var calls [][]string
	b := &toolBootstrapper{
		commandExists: func(name string) bool {
			switch name {
			case "pnpm":
				return false
			case "corepack":
				return true
			default:
				return false
			}
		},
		runCommand: func(_ context.Context, name string, args ...string) error {
			calls = append(calls, append([]string{name}, args...))
			return nil
		},
		logger: log.New(&bytes.Buffer{}, "", 0),
	}

	b.ensurePNPM(context.Background())

	want := [][]string{{"corepack", "enable"}, {"corepack", "prepare", "pnpm@latest", "--activate"}}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("unexpected commands: got %#v want %#v", calls, want)
	}
}

func TestToolBootstrapperFallsBackToNPMForPNPM(t *testing.T) {
	var calls [][]string
	b := &toolBootstrapper{
		commandExists: func(name string) bool {
			switch name {
			case "pnpm", "corepack":
				return false
			case "npm":
				return true
			default:
				return false
			}
		},
		runCommand: func(_ context.Context, name string, args ...string) error {
			calls = append(calls, append([]string{name}, args...))
			return nil
		},
		logger: log.New(&bytes.Buffer{}, "", 0),
	}

	b.ensurePNPM(context.Background())

	want := [][]string{{"npm", "install", "-g", "pnpm"}}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("unexpected commands: got %#v want %#v", calls, want)
	}
}

func TestToolBootstrapperInstallsGHViaApt(t *testing.T) {
	var calls [][]string
	b := &toolBootstrapper{
		commandExists: func(name string) bool {
			switch name {
			case "gh":
				return false
			case "apt-get":
				return true
			default:
				return false
			}
		},
		runCommand: func(_ context.Context, name string, args ...string) error {
			calls = append(calls, append([]string{name}, args...))
			return nil
		},
		logger: log.New(&bytes.Buffer{}, "", 0),
	}

	b.ensureGH(context.Background())

	want := [][]string{{"apt-get", "update", "-qq"}, {"apt-get", "install", "-y", "-qq", "gh"}}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("unexpected commands: got %#v want %#v", calls, want)
	}
}

func TestToolBootstrapperLogsWhenCorepackFails(t *testing.T) {
	var logs bytes.Buffer
	b := &toolBootstrapper{
		commandExists: func(name string) bool {
			switch name {
			case "pnpm":
				return false
			case "corepack":
				return true
			default:
				return false
			}
		},
		runCommand: func(_ context.Context, name string, args ...string) error {
			if name == "corepack" {
				return errors.New("boom")
			}
			return nil
		},
		logger: log.New(&logs, "", 0),
	}

	b.ensurePNPM(context.Background())

	if !bytes.Contains(logs.Bytes(), []byte("corepack enable failed")) {
		t.Fatalf("expected corepack failure log, got %q", logs.String())
	}
	if !bytes.Contains(logs.Bytes(), []byte("pnpm missing and no installer path succeeded")) {
		t.Fatalf("expected pnpm missing log, got %q", logs.String())
	}
}
