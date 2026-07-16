import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <nav class="navbar navbar-expand bg-primary" data-bs-theme="dark">
      <div class="container">
        <a class="navbar-brand fw-bold" routerLink="/admin">🍺 Bierbuzzer</a>
        <div class="navbar-nav">
          <a class="nav-link" routerLink="/admin">Admin</a>
        </div>
      </div>
    </nav>
    <main class="container py-4">
      <router-outlet></router-outlet>
    </main>
  `,
})
export class AppComponent {}
