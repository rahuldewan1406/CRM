# Adding Multi-User Login with RBAC (Role-Based Access Control)

This guide explains how to upgrade this frontend-only CRM into a secure multi-user CRM with role-based permissions.

## 1) Target architecture

Current app is browser-only (`localStorage`). For multi-user + RBAC, split into:

- **Frontend**: existing UI (HTML/CSS/JS)
- **Backend API**: auth, users, roles, permissions, CRM data
- **Database**: PostgreSQL (recommended)

Suggested stack:
- Backend: Node.js + Express (or NestJS)
- Auth: JWT (access + refresh tokens)
- Password hashing: Argon2 (or bcrypt)
- DB: PostgreSQL + Prisma/TypeORM

---

## 2) Define roles and permissions first

Start with a permission matrix.

### Example roles
- `admin`: full access
- `manager`: manage team leads/contacts/tasks, limited user management
- `sales_rep`: manage assigned contacts/leads/tasks only
- `viewer`: read-only

### Example permissions
- `contacts.read`, `contacts.create`, `contacts.update`, `contacts.delete`
- `leads.read`, `leads.create`, `leads.update`, `leads.delete`
- `tasks.read`, `tasks.create`, `tasks.update`, `tasks.delete`
- `users.read`, `users.create`, `users.update`, `users.delete`

Use **least privilege** (give minimum required permissions).

---

## 3) Database schema (minimum)

Use relational tables such as:

- `users(id, name, email, password_hash, is_active, created_at)`
- `roles(id, name)`
- `permissions(id, key)`
- `user_roles(user_id, role_id)`
- `role_permissions(role_id, permission_id)`
- `contacts(..., owner_user_id)`
- `leads(..., owner_user_id)`
- `tasks(..., owner_user_id)`

Why `owner_user_id`?
- Enables row-level ownership checks (e.g., sales rep sees only own records).

---

## 4) Authentication flow

Implement secure login:

1. User registers (or created by admin).
2. Password stored as hashed (`argon2`).
3. Login endpoint verifies credentials.
4. Backend returns:
   - short-lived **access token** (JWT, e.g. 15 min)
   - long-lived **refresh token** (stored securely)
5. Frontend sends access token in `Authorization: Bearer <token>`.
6. Refresh endpoint rotates refresh token.

Security basics:
- Never store plain passwords.
- Use HTTPS in all environments except local development.
- Add login rate limiting and account lockout protections.

---

## 5) Authorization middleware (RBAC)

Add backend middleware:

- `authenticate()` → validates JWT and attaches `req.user`
- `authorize('leads.update')` → checks permission from user roles
- ownership check for non-admin users

Pseudo flow:

```txt
Request -> authenticate -> authorize(permission) -> ownership check -> controller
```

Example rule:
- `admin` can update any lead
- `manager` can update leads in their team
- `sales_rep` can update only leads where `owner_user_id = req.user.id`

---

## 6) API endpoints to introduce

Auth:
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

Users & roles:
- `GET /users`
- `POST /users`
- `PUT /users/:id/roles`
- `GET /roles`
- `PUT /roles/:id/permissions`

CRM resources:
- `GET/POST/PUT/DELETE /contacts`
- `GET/POST/PUT/DELETE /leads`
- `GET/POST/PUT/DELETE /tasks`

Each endpoint should enforce permission checks.

---

## 7) Frontend changes needed

Replace `localStorage` CRM data storage with API calls.

- Add login page/form
- Store access token safely (prefer httpOnly cookie session flow when possible)
- Fetch current user profile + permissions from API
- Hide/disable UI actions user cannot perform
- Show authorization errors clearly (403)

Important:
- UI checks improve UX, but **backend authorization is the real security boundary**.

---

## 8) Migration strategy from current app

1. Keep current UI layout.
2. Build backend with auth + RBAC + DB.
3. Replace JS storage methods with `fetch()` API calls.
4. Add login/logout and route guards.
5. Seed initial admin user and baseline roles.
6. Add audit logging for sensitive changes.

---

## 9) Testing checklist

- Unit tests for permission resolution logic
- API tests for 401/403/200 scenarios
- Ownership tests (users cannot modify others' records)
- Token refresh and logout tests
- Negative tests (deleted user, inactive user, expired token)

---

## 10) Recommended next implementation in this repo

If you want, next step can be to scaffold:

- `server/` (Express API)
- PostgreSQL schema and migrations
- JWT auth endpoints
- RBAC middleware and seeded roles
- Frontend login screen + API integration

This will convert the current static CRM into a real multi-user system.
