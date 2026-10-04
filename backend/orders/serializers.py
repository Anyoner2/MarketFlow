from django.db import transaction
from rest_framework import serializers

from orders.models import Order, OrderItem
from products.models import Product


class OrderItemInputSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class OrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = OrderItem
        fields = ['id', 'product', 'product_name', 'quantity', 'unit_price']
        read_only_fields = fields


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    total_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Order
        fields = ['id', 'order_number', 'status', 'currency', 'items', 'total_amount', 'created_at']
        read_only_fields = fields


class OrderCreateSerializer(serializers.Serializer):
    items = OrderItemInputSerializer(many=True, allow_empty=False)

    def to_representation(self, instance):
        return OrderSerializer(instance, context=self.context).data

    def validate_items(self, items):
        product_ids = [item['product_id'] for item in items]
        if len(product_ids) != len(set(product_ids)):
            raise serializers.ValidationError('Each product may only appear once in an order.')
        return items

    @transaction.atomic
    def create(self, validated_data):
        requested_items = validated_data['items']
        product_ids = [item['product_id'] for item in requested_items]
        products = {
            product.id: product
            for product in Product.objects.select_for_update()
            .filter(id__in=product_ids, is_active=True, store__is_active=True)
            .order_by('id')
        }

        if len(products) != len(product_ids):
            raise serializers.ValidationError({'items': 'One or more products are unavailable.'})

        for item in requested_items:
            product = products[item['product_id']]
            if product.stock_quantity < item['quantity']:
                raise serializers.ValidationError({
                    'items': f'Not enough stock for {product.name}.'
                })

        order = Order.objects.create(customer=self.context['request'].user)
        order_items = []
        for item in requested_items:
            product = products[item['product_id']]
            quantity = item['quantity']
            product.stock_quantity -= quantity
            product.save(update_fields=['stock_quantity', 'updated_at'])
            order_items.append(OrderItem(
                order=order,
                product=product,
                quantity=quantity,
                unit_price=product.price,
            ))
        OrderItem.objects.bulk_create(order_items)
        return order