import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ApiService } from './api.service';

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
export class AppComponent implements OnInit {
  private api = inject(ApiService);

  ngOnInit(): void {
    // Consume deep-link query params and strip them from the URL immediately so
    // they do not linger in the address bar / history.
    //   ?apiKey=...       -> log in with this token
    //   ?provisionMac=... -> open the provisioning wizard for this MAC
    const url = new URL(window.location.href);
    let changed = false;

    const apiKey = url.searchParams.get('apiKey');
    if (apiKey) {
      url.searchParams.delete('apiKey');
      this.api.setToken(apiKey);
      changed = true;
    }

    const mac = url.searchParams.get('provisionMac');
    if (mac) {
      url.searchParams.delete('provisionMac');
      // Persist so it survives the login step, then resume at wizard step 2.
      sessionStorage.setItem('pendingProvisionMac', mac);
      changed = true;
    }

    if (changed) {
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
  }
}
