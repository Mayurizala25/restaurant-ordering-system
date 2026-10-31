import Image from "next/image";
import Link from "next/link";

const highlights = [
  {
    number: "01",
    title: "Made with care",
    description: "Explore a menu of thoughtfully prepared restaurant favorites.",
  },
  {
    number: "02",
    title: "Order with ease",
    description: "Browse dishes and place your order in just a few taps.",
  },
  {
    number: "03",
    title: "Stay in the loop",
    description: "Follow your order as it is prepared.",
  },
];

export default function Home() {
  return (
    <main className="vr-home-page">
      <div className="vr-home-shell">
        <header className="vr-home-header">
          <Link aria-label="Virtual Rudra home" className="vr-home-brand" href="/">
            <Image
              alt=""
              className="vr-home-brand-mark"
              height={48}
              priority
              src="/brand/virtual-rudra-logo.png?v=2"
              unoptimized
              width={64}
            />
            <span>
              <strong>Virtual Rudra</strong>
              <small>RESTAURANT &amp; KITCHEN</small>
            </span>
          </Link>
          <Link className="vr-home-admin-link" href="/admin/login">
            Admin sign in <span aria-hidden="true">↗</span>
          </Link>
        </header>

        <section aria-labelledby="home-title" className="vr-home-hero">
          <div className="vr-home-hero-copy">
            <p className="vr-home-eyebrow">
              <span aria-hidden="true" /> GOOD FOOD, GOOD MOMENTS
            </p>
            <h1 id="home-title">
              Made for memorable <span>meals.</span>
            </h1>
            <p className="vr-home-description">
              A warm welcome, thoughtfully prepared favorites, and an easier way
              to enjoy your time at the table.
            </p>
            <div className="vr-home-actions">
              <Link className="vr-home-primary-action" href="/menu">
                Explore the menu <span aria-hidden="true">→</span>
              </Link>
              <Link className="vr-home-secondary-action" href="/menu">
                Order for your table
              </Link>
            </div>
            <p className="vr-home-reassurance">
              <span aria-hidden="true">✦</span> Thoughtful food, made for sharing
            </p>
          </div>

          <div aria-label="Virtual Rudra restaurant" className="vr-home-visual">
            <div className="vr-home-visual-glow" />
            <div className="vr-home-visual-topline">
              <span>VIRTUAL RUDRA</span>
              <span><i aria-hidden="true" /> ORDER ONLINE</span>
            </div>
            <div className="vr-home-logo-frame">
              <Image
                alt="Virtual Rudra orange chef-hat logo"
                className="vr-home-hero-logo"
                height={312}
                priority
                src="/brand/virtual-rudra-logo.png?v=2"
                unoptimized
                width={416}
              />
            </div>
            <div className="vr-home-visual-caption">
              <span>Made for memorable meals.</span>
              <span aria-hidden="true">✦</span>
            </div>
          </div>
        </section>

        <section aria-label="A better restaurant experience" className="vr-home-highlights">
          {highlights.map((highlight) => (
            <article className="vr-home-highlight" key={highlight.number}>
              <span>{highlight.number}</span>
              <h2>{highlight.title}</h2>
              <p>{highlight.description}</p>
            </article>
          ))}
        </section>

        <footer className="vr-home-footer">
          <span>Virtual Rudra</span>
          <span>Made for memorable meals.</span>
        </footer>
      </div>
    </main>
  );
}
