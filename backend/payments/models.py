from django.db import models


class Payment(models.Model):
	class Status(models.TextChoices):
		PENDING = 'pending', 'Pending'
		SUCCEEDED = 'succeeded', 'Succeeded'
		FAILED = 'failed', 'Failed'
		REFUNDED = 'refunded', 'Refunded'

	order = models.OneToOneField('orders.Order', on_delete=models.PROTECT, related_name='payment')
	amount = models.DecimalField(max_digits=10, decimal_places=2)
	currency = models.CharField(max_length=3, default='KES')
	provider = models.CharField(max_length=40, blank=True)
	provider_reference = models.CharField(max_length=160, blank=True)
	status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-created_at']

	def __str__(self):
		return f'{self.order.order_number}: {self.status}'
