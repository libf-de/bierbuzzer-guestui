import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService, Article, DeviceState } from '../api.service';

@Component({
  selector: 'app-guest',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mx-auto" style="max-width: 32rem;">
      <h1 class="h4 mb-1">Choose your drink</h1>
      <p class="text-secondary small mb-3">
        {{ label() || 'Table button' }} ·
        <code>{{ topicId }}</code>
      </p>

      <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>
      <div *ngIf="message()" class="alert alert-success">{{ message() }}</div>

      <div *ngIf="current() as c" class="alert alert-info d-flex justify-content-between">
        <span>Current: <strong>{{ nameFor(c.articleId) }}</strong></span>
        <span class="badge text-bg-secondary align-self-center">{{ c.source }}</span>
      </div>

      <div class="list-group">
        <button
          *ngFor="let a of articles()"
          class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
          [class.active]="isCurrent(a.id)"
          [disabled]="loading()"
          (click)="pick(a)"
        >
          {{ a.name }}
          <span *ngIf="isCurrent(a.id)" class="badge text-bg-light">selected</span>
        </button>
      </div>

      <p *ngIf="!articles().length && !error()" class="text-secondary mt-3">Loading menu…</p>
    </div>
  `,
})
export class GuestComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);

  topicId = '';
  articles = signal<Article[]>([]);
  current = signal<DeviceState | null>(null);
  label = signal<string | null>(null);
  message = signal('');
  error = signal('');
  loading = signal(false);

  ngOnInit(): void {
    this.topicId = this.route.snapshot.paramMap.get('topicId') ?? '';
    this.load();
  }

  load(): void {
    this.api.listArticles().subscribe({
      next: (r) => this.articles.set(r.articles),
      error: () => this.error.set('Failed to load menu'),
    });
    this.api.getDevice(this.topicId).subscribe({
      next: (d) => {
        this.current.set(d.currentArticle);
        this.label.set(d.label);
      },
      error: (e) => this.error.set(e.error?.error ?? 'Unknown device'),
    });
  }

  pick(a: Article): void {
    this.loading.set(true);
    this.message.set('');
    this.error.set('');
    this.api.setArticle(this.topicId, a.id).subscribe({
      next: (r) => {
        this.loading.set(false);
        this.message.set(
          r.confirmed ? `Set to ${a.name} ✓` : `Queued ${a.name} — device offline, will apply on reconnect`,
        );
        this.load();
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(e.error?.error ?? 'Failed to set article');
      },
    });
  }

  isCurrent(id: string): boolean {
    return this.current()?.articleId === id;
  }

  nameFor(id: string): string {
    return this.articles().find((a) => a.id === id)?.name ?? id;
  }
}
