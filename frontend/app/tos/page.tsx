export default function TosPage() {
  return (
    <section className="max-w-3xl mx-auto space-y-8 py-6">
      <h1 className="font-display text-headline-lg text-secondary drop-shadow-[0_0_15px_rgba(76,215,246,0.3)]">
        {'>'} TERMS OF SERVICE
      </h1>

      <div className="border-2 border-surface-variant bg-surface-container-lowest p-6 space-y-4 font-mono text-sm text-on-surface leading-relaxed">
        <p>
          DARKCOPY is an anonymous content sharing service provided as-is, without any warranties,
          express or implied.
        </p>

        <h2 className="text-secondary text-base uppercase tracking-wider font-bold">1. ACCEPTANCE</h2>
        <p>
          By using DARKCOPY, you agree to these terms. If you do not agree, do not use the service.
        </p>

        <h2 className="text-secondary text-base uppercase tracking-wider font-bold">2. USER CONDUCT</h2>
        <p>You agree not to use DARKCOPY to share:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Illegal content (child exploitation, terrorism, fraud)</li>
          <li>Malware, viruses, or malicious code</li>
          <li>Copyrighted material you do not own or have license to share</li>
          <li>Personal information of others without consent</li>
          <li>Content that promotes hate, violence, or discrimination</li>
        </ul>

        <h2 className="text-secondary text-base uppercase tracking-wider font-bold">3. CONTENT REMOVAL</h2>
        <p>
          We reserve the right to remove any content without notice. Reports of illegal content
          will be reviewed and may be forwarded to relevant authorities.
        </p>

        <h2 className="text-secondary text-base uppercase tracking-wider font-bold">4. DISCLAIMER</h2>
        <p>
          DARKCOPY is not responsible for any content uploaded by users. All content is the sole
          responsibility of the person who uploaded it.
        </p>

        <h2 className="text-secondary text-base uppercase tracking-wider font-bold">5. TECHNICAL DATA, IP PROCESSING & RATE LIMITING</h2>
        <p> To maintain platform stability, prevent abuse, and enforce system boundaries:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Our systems process and temporarily log user IP addresses solely for technical operations, including rate limiting (preventing spam/DDoS), security monitoring, and filtering malicious traffic.</li>
          <li>We do not use IP addresses for user tracking, profiling, or any form of personal identification.</li>
          <li>We do not share IP addresses with third parties, except when legally required or to protect the integrity of our service.</li>
          <li>Rate limiting is implemented to ensure fair usage and prevent abuse. Users exceeding the rate limit may experience temporary access restrictions.</li>
        </ul>

        <h2 className="text-secondary text-base uppercase tracking-wider font-bold">6. REPORTING ABUSE / DMCA TAKEDOWN REQUESTS</h2>
        <p>
          If you encounter any abusive content or behavior, please report it to us using the reporting tools available within the service.
        </p>
        
        <h2 className="text-secondary text-base uppercase tracking-wider font-bold">7. LIMITATION OF LIABILITY</h2>
        <p>
          In no event shall DARKCOPY or its operators be liable for any damages arising from the
          use or inability to use the service.
        </p>
      </div>
    </section>
  );
}
