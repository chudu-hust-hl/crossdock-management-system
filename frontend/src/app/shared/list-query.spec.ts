import { convertToParamMap } from '@angular/router';
import { filtersFromForm, PAGE_LIMIT, queryFromUrl } from './list-query';

describe('queryFromUrl', () => {
  it('reads the filters and the page from the URL, with the fixed limit', () => {
    const params = convertToParamMap({
      page: '3',
      status: 'CREATED',
      other: 'ignored',
    });

    expect(queryFromUrl(params, ['status', 'code'])).toEqual({
      page: '3',
      limit: PAGE_LIMIT,
      status: 'CREATED',
      code: undefined,
    });
  });
});

describe('filtersFromForm', () => {
  it('trims the fields, removes empty ones, and restarts at page 1', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="code" value="  S-0001 ">
      <input name="customerName" value="   ">
      <select name="status"><option value="" selected>All</option></select>`;

    expect(filtersFromForm(form, ['code', 'customerName', 'status'])).toEqual({
      page: null,
      code: 'S-0001',
      customerName: null,
      status: null,
    });
  });
});
