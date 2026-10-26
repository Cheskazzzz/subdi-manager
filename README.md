# Isabel Village Management System

An Isabel Village management system built with Next.js, TypeScript, and Tailwind CSS. It includes a public information and registration page, credential-checked login, password recovery, admin invitations and resident approvals, approval-gated vehicle requests, plus admin, security, and homeowner experiences. Application data is stored in the browser.

The facial-recognition module supports camera enrollment, on-device identity matching, consent confirmation, biometric-template deletion, and automatic approved/denied gate logs. The bundled model files are served locally from `public/models`; captured photos are never retained.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Public registration requests are saved as pending and can be approved from **Homeowners**. Homeowner vehicle requests are saved as pending and can be opened by an admin from **Car Passes**, where a pass number, expiration date, and active status are assigned.

Camera access works on `localhost` during development and on HTTPS deployments. Enroll an active homeowner from **Facial Recognition → Enrollment**, then switch to **Gate verification** to test matching. For better results, use even front lighting and keep exactly one face in the guide.

## Supabase setup

The app works without external services for easy presentation. To connect a hosted database:

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env.local` and add the project URL and anon key.
4. Replace the browser store calls in `lib/store.tsx` with queries from `lib/supabase/client.ts`.

The SQL includes the requested tables, biometric templates, enums, foreign keys, row-level security, and starter policies. The current presentation mode intentionally keeps templates in the browser. For a multi-gate deployment, replace the local template helpers in `components/facial-recognition.tsx` with encrypted Supabase reads/writes and document a formal biometric retention policy.

> Facial recognition is a convenience feature, not a sole security control. Keep manual officer review available, obtain informed consent, restrict template access, and provide deletion/opt-out procedures before real-world use.

## Deployment

Import the repository into Vercel. The default Next.js build settings work as-is. Add the two Supabase environment variables if the hosted backend is enabled.
