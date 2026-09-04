/* =========================================================================
   src/administration/useAdminAccess.js
   Convenience hook returning the access matrix computed by AdminProvider.
   Usage (inside the Administration module only):
       const { isSuperuser, canEditPage, canChangeWishlistStatus } = useAdminAccess();
   ========================================================================= */
import { useAdmin } from './AdminContext';

export const useAdminAccess = () => (useAdmin() || {}).access || {};
