from pathlib import Path

path = Path("order-management.css")
text = path.read_text("utf-8")

old_tokens = '''.order-manager,
.order-work-nav,
.order-cart-actions{
  --order-touch:44px;
  --order-list-gap:8px;
  --order-focus:#2f6fad;
  --order-selected:#2d7a4d;
}'''
new_tokens = ''':root{
  --order-touch:44px;
  --order-focus:#2f6fad;
  --order-selected:#2d7a4d;
}
.order-manager,
.order-work-nav,
.order-cart-actions{
  --order-list-gap:8px;
}'''
if text.count(old_tokens) != 1:
    raise SystemExit("expected one scoped token block")
text = text.replace(old_tokens, new_tokens, 1)

old_touch = '''.order-manager-tabs button,
.order-card-detail-toggle,
.order-card-actions button,
.order-work-nav button,
.order-cart-actions button,
#orderManagerClose,
.order-manager-tool-actions button,
.debt-payment-form button,
.debt-payment-form input{'''
new_touch = '''.order-manager-modes button,
.order-manager-tabs button,
.order-card-detail-toggle,
.order-card-actions button,
.order-work-nav button,
.order-cart-actions button,
.order-manager-entry,
.order-customer-inline,
#orderManagerClose,
#orderCustomerPickerClose,
#orderCustomerSearch,
.order-manager-tool-actions button,
.debt-payment-form button,
.debt-payment-form input{'''
if text.count(old_touch) != 1:
    raise SystemExit("expected one shared touch selector block")
text = text.replace(old_touch, new_touch, 1)

old_transition = '''.order-manager button,
.order-work-nav button,
.order-cart-actions button{
  transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .08s ease;
}'''
new_transition = '''.order-manager button,
.order-work-nav button,
.order-cart-actions button,
.order-manager-entry,
.order-customer-inline{
  transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .08s ease;
}'''
if text.count(old_transition) != 1:
    raise SystemExit("expected one transition block")
text = text.replace(old_transition, new_transition, 1)

old_active = '''.order-manager button:active,
.order-work-nav button:active,
.order-cart-actions button:active{
  transform:translateY(1px);
}'''
new_active = '''.order-manager button:active,
.order-work-nav button:active,
.order-cart-actions button:active,
.order-manager-entry:active,
.order-customer-inline:active{
  transform:translateY(1px);
}'''
if text.count(old_active) != 1:
    raise SystemExit("expected one active block")
text = text.replace(old_active, new_active, 1)

old_focus = '''.order-manager :is(button,input):focus-visible,
.order-work-nav button:focus-visible,
.order-cart-actions button:focus-visible{
  outline:2px solid var(--order-focus);
  outline-offset:2px;
}'''
new_focus = '''.order-manager :is(button,input):focus-visible,
.order-work-nav button:focus-visible,
.order-cart-actions button:focus-visible,
.order-manager-entry:focus-visible,
.order-customer-inline:focus-visible{
  outline:2px solid var(--order-focus);
  outline-offset:2px;
}'''
if text.count(old_focus) != 1:
    raise SystemExit("expected one focus block")
text = text.replace(old_focus, new_focus, 1)

old_reduce = '''  .order-manager button,
  .order-work-nav button,
  .order-cart-actions button{
    transition:none!important;
    transform:none!important;
  }'''
new_reduce = '''  .order-manager button,
  .order-work-nav button,
  .order-cart-actions button,
  .order-manager-entry,
  .order-customer-inline{
    transition:none!important;
    transform:none!important;
  }'''
if text.count(old_reduce) != 1:
    raise SystemExit("expected one reduced-motion block")
text = text.replace(old_reduce, new_reduce, 1)

path.write_text(text, "utf-8")
print("final UI token fix applied")
