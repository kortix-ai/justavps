package main

import (
	"errors"
	"log"
	"net/http"
	"os"
	"sync"

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
	httpsListenAddr := os.Getenv("BROKER_HTTPS_LISTEN_ADDR")
	if httpsListenAddr == "" {
		httpsListenAddr = ":443"
	}
	tlsCertPath := os.Getenv("BROKER_TLS_CERT_PATH")
	tlsKeyPath := os.Getenv("BROKER_TLS_KEY_PATH")

	b := broker.New(broker.Config{
		ListenAddr:      listenAddr,
		HTTPSListenAddr: httpsListenAddr,
		SharedSecret:    secret,
		TLSCertPath:     tlsCertPath,
		TLSKeyPath:      tlsKeyPath,
	})

	httpServer := b.Server()
	tlsServer := b.TLSServer()

	log.Printf("[BROKER] listening on %s", listenAddr)
	if tlsServer != nil {
		log.Printf("[BROKER] listening with TLS on %s", httpsListenAddr)
	}

	errCh := make(chan error, 2)
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	if tlsServer != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := tlsServer.ListenAndServeTLS(tlsCertPath, tlsKeyPath); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errCh <- err
			}
		}()
	}

	if err := <-errCh; err != nil {
		log.Fatal(err)
	}
}
