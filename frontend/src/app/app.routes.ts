import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'admin' },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
  },
  {
    path: 'g/:topicId',
    loadComponent: () => import('./guest/guest.component').then((m) => m.GuestComponent),
  },
  { path: '**', redirectTo: 'admin' },
];
