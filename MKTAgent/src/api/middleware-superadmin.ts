// Super-admin gate (credit-wallet Phase 03). Mounts AFTER requireAuth (req.userId set) and checks the
// platform-level User.isSuperAdmin flag. A non-admin gets 404 — NOT 403 — so the admin surface's very
// existence isn't revealed by probing. The obscure /superadminatria101 URL is defense-in-depth; THIS is
// the real security boundary.
import type { Request, Response, NextFunction } from 'express';
import { getUserById } from '../db/repos/user-repo.ts';

export const requireSuperAdmin = (req: Request, res: Response, next: NextFunction): void => {
  void getUserById(req.userId!)
    .then((user) => {
      if (!user?.isSuperAdmin) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      next();
    })
    .catch(() => res.status(404).json({ error: 'not_found' }));
};
