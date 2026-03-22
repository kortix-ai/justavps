package main

import (
	"log"
	"os"

	"github.com/heyagi/justavps-daemon/internal/broker"
)

func main() {
	secret := os.Getenv("BROKER_SHARED_SECRET")
	if secret == "" {
		log.Fatal("BROKER_SHARED_SECRET is required")
	}

	listenAddr := os.Getenv("BROKER_LISTEN_ADDR")
	if listenAddr == "" {
		listenAddr = ":80"
	}

	b := broker.New(broker.Config{
		ListenAddr:   listenAddr,
		SharedSecret: secret,
	})

	server := b.Server()
	log.Printf("[BROKER] listening on %s", listenAddr)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
