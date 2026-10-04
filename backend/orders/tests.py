from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from orders.models import Order, OrderItem
from payments.models import Payment
from products.models import Product
from stores.models import Store

User = get_user_model()


class OrderModelTests(TestCase):
	def test_order_total_uses_saved_unit_price_and_payment_links_to_order(self):
		customer = User.objects.create_user(username='buyer', password='A-strong-pass-123')
		owner = User.objects.create_user(username='maker', password='A-strong-pass-123')
		store = Store.objects.create(owner=owner, name='Good Things', slug='good-things')
		product = Product.objects.create(store=store, name='Cup', price='18.00', stock_quantity=5)
		order = Order.objects.create(customer=customer)
		OrderItem.objects.create(order=order, product=product, quantity=2, unit_price='15.00')
		product.price = Decimal('20.00')
		product.save()

		self.assertEqual(order.total_amount, Decimal('30.00'))

		payment = Payment.objects.create(order=order, amount=order.total_amount)
		self.assertEqual(order.payment, payment)
