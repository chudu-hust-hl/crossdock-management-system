import { Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/** Previous / next page of a list; the page number is kept in the URL (`?page=`). */
@Component({
  selector: 'app-pager',
  template: `
    <div class="pager">
      <button type="button" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
      <span>Page {{ page() }} of {{ pageCount() }} · {{ total() }} total</span>
      <button type="button" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">
        Next
      </button>
    </div>
  `,
})
export class Pager {
  readonly page = input.required<number>();
  readonly limit = input.required<number>();
  readonly total = input.required<number>();

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit())),
  );

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected go(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }
}
