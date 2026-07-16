import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService, AckState, DeviceStatus, GuestPreset } from '../api.service';

@Component({
  selector: 'app-guest',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mx-auto" style="max-width: 32rem;">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <h1 class="h4 m-0">{{ label() || 'Table button' }}</h1>
        <span
          class="badge"
          [class.text-bg-success]="status()?.state === 'online'"
          [class.text-bg-secondary]="status()?.state !== 'online'"
        >
          {{ status()?.state || 'unknown' }}
        </span>
      </div>
      <p class="text-secondary small mb-3"><code>{{ topicId }}</code></p>

      <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>
      <div *ngIf="message()" class="alert alert-success">{{ message() }}</div>

      <div *ngIf="applied() as a" class="alert alert-info small">
        Current: <strong>{{ describe(a) }}</strong>
      </div>

      <h2 class="h6 text-secondary">Choose a preset</h2>
      <div class="list-group">
        <button
          *ngFor="let p of presets()"
          class="list-group-item list-group-item-action"
          [disabled]="loading()"
          (click)="pick(p)"
        >
          <div class="fw-semibold">{{ p.name }}</div>
          <div class="small text-secondary">
            {{ p.orderMode.mode }}<span *ngIf="p.articles.length"> · {{ p.articles.length }} article(s)</span>
          </div>
        </button>
      </div>

      <p *ngIf="!presets().length && !error()" class="text-secondary mt-3">
        No presets available for this button yet.
      </p>
    </div>
  `,
})
export class GuestComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);

  topicId = '';
  presets = signal<GuestPreset[]>([]);
  applied = signal<AckState | null>(null);
  status = signal<DeviceStatus | null>(null);
  label = signal<string | null>(null);
  message = signal('');
  error = signal('');
  loading = signal(false);

  ngOnInit(): void {
    this.topicId = this.route.snapshot.paramMap.get('topicId') ?? '';
    this.load();
  }

  load(): void {
    this.api.getDevice(this.topicId).subscribe({
      next: (d) => {
        this.presets.set(d.presets);
        this.applied.set(d.applied);
        this.status.set(d.status);
        this.label.set(d.label);
      },
      error: (e) => this.error.set(e.error?.error ?? 'Unknown device'),
    });
  }

  pick(p: GuestPreset): void {
    this.loading.set(true);
    this.message.set('');
    this.error.set('');
    this.api.selectPreset(this.topicId, p.id).subscribe({
      next: (r) => {
        this.loading.set(false);
        this.message.set(
          r.confirmed ? `Applied "${p.name}" ✓` : `Queued "${p.name}" — device offline, applies on reconnect`,
        );
        this.load();
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(e.error?.error ?? 'Failed to apply preset');
      },
    });
  }

  describe(a: AckState): string {
    const mode = a.orderMode?.mode ?? '—';
    const count = a.articles?.length ?? 0;
    return `${mode}, ${count} article(s)${a.ok ? '' : ' (rejected)'}`;
  }
}
