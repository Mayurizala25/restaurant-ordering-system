import Image from "next/image";
import Link from "next/link";
import styles from "./home.module.css";

export default function Home() {
  return (
    <div className={`vr-home-page ${styles.page}`} data-customer-theme="dark">
      <header className="vr-home-header">
        <Link aria-label="Virtual Rudra home" className="vr-home-brand" href="/">
          <Image
            alt=""
            className="vr-home-brand-mark"
            height={55}
            src="/brand/virtual-rudra-logo.png"
            unoptimized
            width={80}
          />
          <span>
            <strong>Virtual Rudra</strong>
            <small>RESTAURANT &amp; KITCHEN</small>
          </span>
        </Link>
        <Link className="vr-home-admin-link" href="/admin/login">
          <svg
            aria-hidden="true"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          >
            <path d="M12 3 4.5 6v5.5c0 4.7 3.2 7.7 7.5 9.5 4.3-1.8 7.5-4.8 7.5-9.5V6L12 3Z" />
            <circle cx="16.5" cy="16.5" r="3" />
            <path d="M16.5 15v1.7l1.2.7" />
          </svg>
          <span>Admin Side</span>
        </Link>
      </header>

      <main className="vr-home-shell">
        <figure className="vr-home-food">
          <Image
            alt="Awadhi dishes served at Virtual Rudra"
            className="vr-home-food-image"
            fill
            fetchPriority="high"
            loading="eager"
            sizes="(max-width: 600px) calc(100vw - 28px), (max-width: 820px) min(580px, calc(100vw - 32px)), min(620px, calc(50vw - 72px))"
            src="/brand/virtual-rudra-awadhi-hero.jpg"
            unoptimized
          />
          <div className="vr-home-food-tag">
            <Image
              alt=""
              height={22}
              src="/brand/virtual-rudra-logo.png"
              unoptimized
              width={32}
            />
            <span>HERITAGE KITCHEN</span>
          </div>
          <figcaption className="vr-home-food-caption">
            <span className="vr-home-dish-name">
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              >
                <path d="M4 3v7m4-7v7M4 7h4m-2 3v11m10-18v18m0-18c3 2 4 5 4 9h-4" />
              </svg>
              Signature Awadhi Thaal
            </span>
            <span className="vr-home-rating">4.9 ★ &nbsp;(12k+ Feasts)</span>
          </figcaption>
        </figure>

        <section aria-labelledby="home-title" className="vr-home-copy">
          <p className="vr-home-eyebrow">
            <span aria-hidden="true" />
            AWADHI HERITAGE · MADE FRESH DAILY
          </p>
          <h1 id="home-title">
            Awadhi flavors,
            <br className="vr-home-title-break" />
            made for sharing.
          </h1>
          <p>
            Savor heritage Awadhi dum biryanis, slow-simmered gravies, and
            charred tandoori delicacies prepared fresh daily.
          </p>
        </section>

        <Link className="vr-home-menu-link" href="/menu">
          <span aria-hidden="true" className="vr-home-menu-icon">
            <svg
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
            >
              <path d="M3 5.5c3.4-1.5 6.1-.7 9 1.2v14c-2.9-1.9-5.6-2.7-9-1.2zM21 5.5c-3.4-1.5-6.1-.7-9 1.2v14c2.9-1.9 5.6-2.7 9-1.2z" />
              <path d="M6 9c1.3-.4 2.4-.3 3.5.2m5-0.2c1.1-.5 2.2-.6 3.5-.2M6 12c1.3-.4 2.4-.3 3.5.2m5-.2c1.1-.5 2.2-.6 3.5-.2" />
            </svg>
          </span>
          <span className="vr-home-menu-copy">
            <strong>Explore Menu</strong>
            <span>Live Tandoor, Handis &amp; Curries</span>
          </span>
          <span aria-hidden="true" className="vr-home-menu-arrow">
            →
          </span>
        </Link>

        <Link
          className="vr-home-kitchen-link"
          href="/kitchen"
        >
          <span className="vr-home-kitchen-copy">
            <span aria-hidden="true" className="vr-home-kitchen-icon">
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              >
                <path d="M4 19h16M6 19a6 6 0 0 1 12 0M12 5v3m-4-1 1.5 2m5-2L13 9" />
              </svg>
            </span>
            <strong>Kitchen Side</strong>
          </span>
          <span aria-hidden="true" className="vr-home-kitchen-arrow">
            →
          </span>
        </Link>

        <footer className="vr-home-location">
          <span>Virtual Rudra Gastronomy Pvt. Ltd.</span>
        </footer>
      </main>
    </div>
  );
}
