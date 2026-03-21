package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"time"
)

const toolBootstrapTimeout = 5 * time.Minute

var osGeteuid = os.Geteuid

func StartToolBootstrap(ctx context.Context) {
	go NewToolBootstrapper().Run(ctx)
}

type toolBootstrapper struct {
	commandExists func(string) bool
	runCommand    func(context.Context, string, ...string) error
	logger        *log.Logger
}

func NewToolBootstrapper() *toolBootstrapper {
	return &toolBootstrapper{
		commandExists: func(name string) bool {
			_, err := exec.LookPath(name)
			return err == nil
		},
		runCommand: runToolBootstrapCommand,
		logger:     log.Default(),
	}
}

func runToolBootstrapCommand(ctx context.Context, name string, args ...string) error {
	cmdCtx, cancel := context.WithTimeout(ctx, toolBootstrapTimeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, name, args...)
	if name == "corepack" {
		cmd.Env = append(os.Environ(), "COREPACK_ENABLE_DOWNLOAD_PROMPT=0")
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %w (%s)", name, args, err, string(output))
	}
	return nil
}

func (b *toolBootstrapper) Run(ctx context.Context) {
	if osGeteuid() != 0 {
		b.logger.Printf("[BOOTSTRAP] Skipping tool install bootstrap: requires root")
		return
	}
	if err := ctx.Err(); err != nil {
		return
	}

	b.ensurePNPM(ctx)
	b.ensureGH(ctx)
}

func (b *toolBootstrapper) ensurePNPM(ctx context.Context) {
	if b.commandExists("pnpm") {
		return
	}

	if b.commandExists("corepack") {
		if err := b.runCommand(ctx, "corepack", "enable"); err == nil {
			if err := b.runCommand(ctx, "corepack", "prepare", "pnpm@latest", "--activate"); err == nil {
				b.logger.Printf("[BOOTSTRAP] Installed pnpm via corepack")
				return
			} else {
				b.logger.Printf("[BOOTSTRAP] corepack prepare pnpm failed: %v", err)
			}
		} else {
			b.logger.Printf("[BOOTSTRAP] corepack enable failed: %v", err)
		}
	}

	if b.commandExists("npm") {
		if err := b.runCommand(ctx, "npm", "install", "-g", "pnpm"); err == nil {
			b.logger.Printf("[BOOTSTRAP] Installed pnpm via npm")
			return
		} else {
			b.logger.Printf("[BOOTSTRAP] npm install -g pnpm failed: %v", err)
		}
	}

	b.logger.Printf("[BOOTSTRAP] pnpm missing and no installer path succeeded")
}

func (b *toolBootstrapper) ensureGH(ctx context.Context) {
	if b.commandExists("gh") {
		return
	}
	if !b.commandExists("apt-get") {
		b.logger.Printf("[BOOTSTRAP] gh missing and apt-get unavailable")
		return
	}

	if err := b.runCommand(ctx, "apt-get", "update", "-qq"); err != nil {
		b.logger.Printf("[BOOTSTRAP] apt-get update for gh failed: %v", err)
		return
	}
	if err := b.runCommand(ctx, "apt-get", "install", "-y", "-qq", "gh"); err != nil {
		b.logger.Printf("[BOOTSTRAP] apt-get install gh failed: %v", err)
		return
	}

	b.logger.Printf("[BOOTSTRAP] Installed gh via apt")
}
